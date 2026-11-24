/**
 * Correo transaccional con Postmark (/admin/configuracion/postmark): activación guiada con la cuenta PROPIA de la
 * empresa. 1) pegar el token del servidor y el remitente, 2) comprobar (solo lectura), 3) copiar en Postmark la URL del
 * webhook y su token, 4) ver el estado. Sin configurar, los correos salen por el servicio de Elephant Source. Las
 * campañas comerciales no pasan por aquí (van por Brevo marketing). La autorización la aplica el servidor.
 *
 * Solo presentación: cabecera con el estado y el avance de los pasos, vías de salida en tarjetas, pasos con insignia
 * de estado, indicadores de envío y estado de guardado. El token del servidor sigue enmascarado (`type=password`,
 * `autoComplete=new-password`) y nunca se muestra el guardado: solo sus últimos caracteres.
 */
import { useState } from "react";
import { serviceFieldProps, serviceSecretProps } from "@/lib/credentialFields";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Copy, Inbox, KeyRound, Loader2, Mail, Send, Server, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { HeroCard, MetricCard } from "@/components/admin/PanelVisual";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeIntegrationText } from "@shared/i18n/integrationsDe";
import type { Translate } from "@shared/i18n/core";

const STAT_KEYS = ["accepted", "delivered", "soft_bounced", "bounced", "blocked", "complained", "failed", "pending"];
/** Significado de cada contador de envíos: lo bueno en verde, lo que pide atención en aviso o error. */
const STAT_TONE: Record<string, Tone> = { accepted: "info", delivered: "success", soft_bounced: "warning", bounced: "danger", blocked: "danger", complained: "danger", failed: "danger", pending: "neutral" };

async function copy(t: Translate, text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("settingsPostmark.copied", { what }));
  } catch {
    toast.error(t("settingsPostmark.copyFailed"));
  }
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm" aria-label={title}>
      <h2 className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-4 py-3 text-sm font-semibold text-foreground sm:px-5">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-primary text-primary-foreground" : "border border-border bg-background text-muted-foreground"}`}
          aria-hidden="true"
        >
          {done ? <CheckCircle2 className="h-4 w-4" /> : n}
        </span>
        <span className="min-w-0 flex-1 break-words">{title}</span>
        <StatusBadge tone={done ? "success" : "neutral"}>{done ? t("settingsPostmark.stepDone") : t("settingsPostmark.stepPending")}</StatusBadge>
      </h2>
      <div className="space-y-3 p-4 sm:p-5">{children}</div>
    </section>
  );
}

function RouteCard({ icon, title, inUse, children }: { icon: React.ReactNode; title: string; inUse?: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={`space-y-2 rounded-xl border p-4 text-sm ${inUse ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">{icon}</span>
        <h3 className="min-w-0 flex-1 break-words font-semibold text-foreground">{title}</h3>
        {inUse && <StatusBadge tone="brand">{t("settingsPostmark.routes.inUse")}</StatusBadge>}
      </div>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

export default function PostmarkSettings() {
  const { t, format, locale } = useI18n();
  const utils = trpc.useUtils();
  const status = trpc.postmarkTenant.status.useQuery(undefined, { retry: false });
  const [token, setToken] = useState("");
  const [stream, setStream] = useState("");
  const [from, setFrom] = useState("");
  const [newWebhookToken, setNewWebhookToken] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const refresh = () => utils.postmarkTenant.status.invalidate();
  const save = trpc.postmarkTenant.save.useMutation({ onSuccess: () => (toast.success(t("settingsPostmark.saved")), setToken(""), setStream(""), setFrom(""), refresh()), onError: (e) => toastError(e) });
  const verify = trpc.postmarkTenant.verify.useMutation({
    onSuccess: (r) => {
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      refresh();
    },
    onError: (e) => toastError(e),
  });
  const gen = trpc.postmarkTenant.generateWebhookToken.useMutation({ onSuccess: (r) => (setNewWebhookToken(r.token), refresh()), onError: (e) => toastError(e) });
  const off = trpc.postmarkTenant.disconnect.useMutation({ onSuccess: () => (toast.success(t("settingsPostmark.disconnected")), setNewWebhookToken(null), refresh()), onError: (e) => toastError(e) });

  const s = status.data;
  const dirty = !!token || !!stream || !!from;
  // Avance de la puesta en marcha: los cuatro pasos con la misma regla que su insignia.
  const stepsDone = s ? [s.serverToken.set && !!s.fromEmail, s.connection === "connected" && s.sender.verified, s.webhook.configured, !!s.stats30d && Object.keys(s.stats30d).length > 0].filter(Boolean).length : 0;
  const statEntries = s?.stats30d ? Object.entries(s.stats30d) : [];
  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        <PanelPageHeader
          className="mb-0"
          icon={<Mail />}
          title={t("settingsPostmark.title")}
          description={<>{t("settingsPostmark.introBefore")}<Link href="/admin/marketing/brevo" className="text-primary underline-offset-4 hover:underline">{t("settingsPostmark.introLink")}</Link>.</>}
        />

        {status.isLoading && <PanelLoading />}
        {status.error && <PanelError error={status.error} onRetry={() => status.refetch()} />}

        {s && (
          <HeroCard>
            <div role="status" className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl [&_svg]:h-6 [&_svg]:w-6 ${s.active ? "bg-primary/15 text-primary" : "bg-warning/15 text-warning"}`} aria-hidden="true">
                {s.active ? <CheckCircle2 /> : <AlertTriangle />}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-words text-base font-semibold text-foreground">{s.active ? t("settingsPostmark.active", { email: s.fromEmail }) : t("settingsPostmark.inactive")}</p>
                {s.problemText && s.configured && <p className="text-sm text-muted-foreground">{s.problemText}</p>}
                {s.lastCheck && (
                  <p className="text-sm text-muted-foreground">
                    {t("settingsPostmark.lastCheck", { date: format.dateTime(s.lastCheck.at, { dateStyle: "short", timeStyle: "medium" }), message: s.lastCheck.message })}
                  </p>
                )}
              </div>
              <div className="w-full shrink-0 space-y-1.5 sm:w-48">
                <p className="text-xs font-medium text-muted-foreground">{t("settingsPostmark.progress", { done: stepsDone, total: 4 })}</p>
                <div className="flex gap-1" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <span key={i} className={`h-1.5 flex-1 rounded-full ${i < stepsDone ? "bg-primary" : "bg-muted"}`} />
                  ))}
                </div>
              </div>
            </div>
          </HeroCard>
        )}

        <section aria-labelledby="vias-correo" className="space-y-3">
          <div className="space-y-1">
            <h2 id="vias-correo" className="text-sm font-semibold text-foreground">{t("settingsPostmark.routes.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("settingsPostmark.routes.included")}</p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <RouteCard icon={<Send />} title={t("settingsPostmark.routes.postmarkLead")} inUse={!!s?.active}>
              {t("settingsPostmark.routes.cardPostmark")}
            </RouteCard>
            <RouteCard icon={<Server />} title={t("settingsPostmark.routes.smtpLead")}>
              {t("settingsPostmark.routes.cardSmtp")}{" "}
              <Link href="/admin/configuracion/integraciones" className="text-primary underline-offset-4 hover:underline">{t("settingsPostmark.routes.smtpLink")}</Link>
            </RouteCard>
            <RouteCard icon={<Inbox />} title={t("settingsPostmark.routes.elephantLead")}>
              {t("settingsPostmark.routes.cardElephant")}
            </RouteCard>
          </div>
          <p className="text-xs text-muted-foreground">{t("settingsPostmark.routes.own")}</p>
        </section>

        {s && (
          <>
            <Step n={1} title={t("settingsPostmark.step1.title")} done={s.serverToken.set && !!s.fromEmail}>
              <p className="text-sm text-muted-foreground">
                {t("settingsPostmark.step1.helpBefore")}<strong>API Tokens</strong>{t("settingsPostmark.step1.helpMid")}<strong>Server API token</strong>{t("settingsPostmark.step1.helpAfter")}
              </p>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate({ serverToken: token || undefined, messageStream: stream || undefined, fromEmail: from || undefined });
                }}
              >
                <label className="space-y-1.5 text-sm font-medium text-foreground sm:col-span-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {t("settingsPostmark.step1.token")} <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" aria-label={t("settingsPostmark.step1.encrypted")} />
                    {s.serverToken.set && <StatusBadge tone="success" icon={<CheckCircle2 />}>{t("settingsPostmark.step1.stored", { display: s.serverToken.display })}</StatusBadge>}
                  </span>
                  <Input type="password" {...serviceSecretProps("postmark-token-servidor")} value={token} onChange={(e) => setToken(e.target.value)} placeholder={s.serverToken.set ? t("settingsPostmark.step1.keepPlaceholder") : t("settingsPostmark.step1.pastePlaceholder")} />
                </label>
                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  <span>{t("settingsPostmark.step1.sender")}</span>
                  <Input type="email" {...serviceFieldProps("postmark-remitente")} value={from} onChange={(e) => setFrom(e.target.value)} placeholder={s.fromEmail ?? "reservas@tuempresa.es"} />
                  <span className="block text-xs font-normal text-muted-foreground">{t("settingsPostmark.step1.senderHelp")}</span>
                </label>
                <label className="space-y-1.5 text-sm font-medium text-foreground">
                  <span>{t("settingsPostmark.step1.stream")}</span>
                  <Input {...serviceFieldProps("postmark-flujo")} value={stream} onChange={(e) => setStream(e.target.value)} placeholder={s.messageStream} />
                  <span className="block text-xs font-normal text-muted-foreground">{t("settingsPostmark.step1.streamHelp")}</span>
                </label>
                <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                  <Button type="submit" disabled={save.isPending || !dirty}>
                    {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                    {save.isPending ? t("settingsPostmark.saving") : t("settingsPostmark.step1.save")}
                  </Button>
                  <span role="status" className="text-xs text-muted-foreground">{dirty && !save.isPending ? t("settingsPostmark.unsaved") : ""}</span>
                </div>
              </form>
            </Step>

            <Step n={2} title={t("settingsPostmark.step2.title")} done={s.connection === "connected" && s.sender.verified}>
              <p className="text-sm text-muted-foreground">{t("settingsPostmark.step2.help")}</p>
              <dl className="grid gap-1 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted-foreground">{t("settingsPostmark.step2.senderDomain")}</dt>
                <dd className="break-words text-foreground">
                  {s.sender.domain ?? "—"} {s.sender.domain && (s.sender.verified ? <StatusBadge tone="success">{t("settingsPostmark.step2.verified")}</StatusBadge> : <StatusBadge tone="warning">{t("settingsPostmark.step2.notVerified")}</StatusBadge>)}
                </dd>
                <dt className="text-muted-foreground">{t("settingsPostmark.step2.verifiedDomains")}</dt>
                <dd className="break-words text-foreground">{s.sender.verifiedDomains.length ? s.sender.verifiedDomains.join(", ") : t("settingsPostmark.step2.none")}</dd>
              </dl>
              <p className="text-xs text-muted-foreground">
                {t("settingsPostmark.step2.signBefore")}<strong>Sender Signatures</strong>{t("settingsPostmark.step2.signAfter")}<Link href="/admin/configuracion/dominios" className="text-primary underline-offset-4 hover:underline">{t("settingsPostmark.step2.signLink")}</Link>.
              </p>
              <Button variant="outline" disabled={!s.serverToken.set || verify.isPending} onClick={() => verify.mutate()}>
                {verify.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t("settingsPostmark.step2.test")}
              </Button>
              {verify.data && (
                <div className={`space-y-1 rounded-lg border p-3 text-sm ${verify.data.ok ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5"}`}>
                  <p className={verify.data.ok ? "text-foreground" : "text-destructive"}>{localizeIntegrationText(verify.data.message, locale)}</p>
                  {verify.data.serverName && <p className="text-muted-foreground">{t("settingsPostmark.step2.server", { name: verify.data.serverName, type: verify.data.deliveryType ?? "—" })}</p>}
                  {verify.data.stream.found && <p className="text-muted-foreground">{t("settingsPostmark.step2.stream", { id: verify.data.stream.id, type: verify.data.stream.type })}</p>}
                  {verify.data.sender.problemText && <p className="text-warning">{verify.data.sender.problemText}</p>}
                </div>
              )}
            </Step>

            <Step n={3} title={t("settingsPostmark.step3.title")} done={s.webhook.configured}>
              <p className="text-sm text-muted-foreground">
                {t("settingsPostmark.step3.helpBefore", { stream: s.messageStream })}<strong>Webhooks</strong>{t("settingsPostmark.step3.helpMid")}<strong>Add webhook</strong>{t("settingsPostmark.step3.helpAfter", { events: s.webhook.events.join(", ") })}
              </p>
              <dl className="grid gap-3 text-sm">
                <div className="space-y-1">
                  <dt className="text-xs font-medium text-muted-foreground">{t("settingsPostmark.step3.url")}</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 break-all rounded bg-muted px-2 py-1 text-xs text-foreground">{s.webhook.url ?? t("settingsPostmark.step3.noPublicUrl")}</code>
                    {s.webhook.url && (
                      <Button size="sm" variant="ghost" onClick={() => copy(t, s.webhook.url!, t("settingsPostmark.copyWhatUrl"))} aria-label={t("settingsPostmark.step3.copyUrl")}>
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    )}
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs font-medium text-muted-foreground">{t("settingsPostmark.step3.headerName")}</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-muted px-2 py-1 text-xs text-foreground">{s.webhook.header}</code>
                    <Button size="sm" variant="ghost" onClick={() => copy(t, s.webhook.header, t("settingsPostmark.copyWhatHeader"))} aria-label={t("settingsPostmark.step3.copyHeader")}>
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs font-medium text-muted-foreground">{t("settingsPostmark.step3.headerValue")}</dt>
                  <dd className="space-y-2">
                    {newWebhookToken ? (
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="min-w-0 break-all rounded bg-muted px-2 py-1 text-xs text-foreground">{newWebhookToken}</code>
                          <Button size="sm" variant="ghost" onClick={() => copy(t, newWebhookToken, t("settingsPostmark.copyWhatToken"))} aria-label={t("settingsPostmark.step3.copyToken")}>
                            <Copy className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                        <p className="rounded-lg border border-warning/40 bg-warning/5 p-2 text-xs text-foreground">{t("settingsPostmark.step3.copyNow")}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{s.webhook.configured ? t("settingsPostmark.step3.generated") : t("settingsPostmark.step3.notGenerated")}</p>
                    )}
                    <Button size="sm" variant="outline" disabled={gen.isPending} onClick={() => gen.mutate()}>
                      {gen.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                      {s.webhook.configured ? t("settingsPostmark.step3.genAnother") : t("settingsPostmark.step3.gen")}
                    </Button>
                  </dd>
                </div>
              </dl>
            </Step>

            <Step n={4} title={t("settingsPostmark.step4.title")} done={statEntries.length > 0}>
              {statEntries.length ? (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {statEntries.map(([k, n]) => (
                    <li key={k}>
                      <MetricCard compact tone={STAT_TONE[k] ?? "neutral"} icon={<Mail />} label={STAT_KEYS.includes(k) ? t(`settingsPostmark.stat.${k}`) : k} value={n} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0" aria-hidden="true" /> {t("settingsPostmark.step4.empty")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{t("settingsPostmark.step4.detail")}</p>
            </Step>

            {s.configured && (
              <section className="flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t("settingsPostmark.confirm.text")}</p>
                <Button variant="outline" className="border-danger/40 text-danger hover:text-danger" onClick={() => setConfirmOff(true)}>
                  <Unplug className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("settingsPostmark.disconnect")}
                </Button>
              </section>
            )}
          </>
        )}
        <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("settingsPostmark.confirm.title")}</AlertDialogTitle>
              <AlertDialogDescription>{t("settingsPostmark.confirm.text")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("settingsPostmark.confirm.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => off.mutate()}>{t("settingsPostmark.confirm.action")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AdminLayout>
  );
}
