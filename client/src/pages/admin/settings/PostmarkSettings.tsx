/**
 * Correo transaccional con Postmark (/admin/configuracion/postmark): activación guiada con la cuenta PROPIA de la
 * empresa. 1) pegar el token del servidor y el remitente, 2) comprobar (solo lectura), 3) copiar en Postmark la URL del
 * webhook y su token, 4) ver el estado. Sin configurar, los correos salen por el servicio de Elephant Source. Las
 * campañas comerciales no pasan por aquí (van por Brevo marketing). La autorización la aplica el servidor.
 */
import { useState } from "react";
import { serviceFieldProps, serviceSecretProps } from "@/lib/credentialFields";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Mail, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeIntegrationText } from "@shared/i18n/integrationsDe";
import type { Translate } from "@shared/i18n/core";

const STAT_KEYS = ["accepted", "delivered", "soft_bounced", "bounced", "blocked", "complained", "failed", "pending"];

async function copy(t: Translate, text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("settingsPostmark.copied", { what }));
  } catch {
    toast.error(t("settingsPostmark.copyFailed"));
  }
}

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label={title}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {done ? <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" /> : <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border text-xs">{n}</span>}
        {title}
      </h2>
      {children}
    </section>
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
  const save = trpc.postmarkTenant.save.useMutation({ onSuccess: () => (toast.success(t("settingsPostmark.saved")), setToken(""), refresh()), onError: (e) => toastError(e) });
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
  return (
    <AdminLayout>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("settingsPostmark.eyebrow")}</p>
          <h1 className="text-2xl font-bold text-foreground">{t("settingsPostmark.title")}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t("settingsPostmark.introBefore")}
            <Link href="/admin/marketing/brevo" className="text-primary underline-offset-4 hover:underline">{t("settingsPostmark.introLink")}</Link>.
          </p>
        </header>

        <section aria-labelledby="vias-correo" className="space-y-2 rounded-xl border border-border p-4 text-sm">
          <h2 id="vias-correo" className="font-semibold text-foreground">{t("settingsPostmark.routes.title")}</h2>
          <p className="text-muted-foreground">{t("settingsPostmark.routes.included")}</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">{t("settingsPostmark.routes.postmarkLead")}</span>
              {t("settingsPostmark.routes.postmarkText")}
            </li>
            <li>
              <span className="font-medium text-foreground">{t("settingsPostmark.routes.smtpLead")}</span>
              {t("settingsPostmark.routes.smtpMid")}
              <Link href="/admin/configuracion/integraciones" className="text-primary underline-offset-4 hover:underline">{t("settingsPostmark.routes.smtpLink")}</Link>
              {t("settingsPostmark.routes.smtpAfter")}
            </li>
            <li>
              <span className="font-medium text-foreground">{t("settingsPostmark.routes.elephantLead")}</span>
              {t("settingsPostmark.routes.elephantText")}
            </li>
          </ul>
          <p className="text-muted-foreground">{t("settingsPostmark.routes.own")}</p>
        </section>

        {status.isLoading && <PanelLoading />}
        {status.error && <PanelError error={status.error} onRetry={() => status.refetch()} />}
        {s && (
          <>
            <div role="status" className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${s.active ? "border-primary/40 bg-primary/5 text-foreground" : "border-border bg-muted/40 text-foreground"}`}>
              {s.active ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />}
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{s.active ? t("settingsPostmark.active", { email: s.fromEmail }) : t("settingsPostmark.inactive")}</p>
                {s.problemText && s.configured && <p className="text-muted-foreground">{s.problemText}</p>}
                {s.lastCheck && (
                  <p className="text-muted-foreground">
                    {t("settingsPostmark.lastCheck", { date: format.dateTime(s.lastCheck.at, { dateStyle: "short", timeStyle: "medium" }), message: s.lastCheck.message })}
                  </p>
                )}
              </div>
            </div>

            <Step n={1} title={t("settingsPostmark.step1.title")} done={s.serverToken.set && !!s.fromEmail}>
              <p className="text-sm text-muted-foreground">
                {t("settingsPostmark.step1.helpBefore")}<strong>API Tokens</strong>{t("settingsPostmark.step1.helpMid")}<strong>Server API token</strong>{t("settingsPostmark.step1.helpAfter")}
              </p>
              <form
                className="grid gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate({ serverToken: token || undefined, messageStream: stream || undefined, fromEmail: from || undefined });
                }}
              >
                <label className="space-y-1.5 text-sm font-medium text-foreground sm:col-span-2">
                  <span className="flex items-center gap-1.5">
                    {t("settingsPostmark.step1.token")} <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" aria-label={t("settingsPostmark.step1.encrypted")} />
                    {s.serverToken.set && <span className="text-xs font-normal text-muted-foreground">{t("settingsPostmark.step1.stored", { display: s.serverToken.display })}</span>}
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
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={save.isPending || (!token && !stream && !from)}>{t("settingsPostmark.step1.save")}</Button>
                </div>
              </form>
            </Step>

            <Step n={2} title={t("settingsPostmark.step2.title")} done={s.connection === "connected" && s.sender.verified}>
              <p className="text-sm text-muted-foreground">{t("settingsPostmark.step2.help")}</p>
              <dl className="grid gap-1 text-sm sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted-foreground">{t("settingsPostmark.step2.senderDomain")}</dt>
                <dd className="break-words text-foreground">
                  {s.sender.domain ?? "—"} {s.sender.domain && (s.sender.verified ? <span className="text-primary">{t("settingsPostmark.step2.verified")}</span> : <span className="text-warning">{t("settingsPostmark.step2.notVerified")}</span>)}
                </dd>
                <dt className="text-muted-foreground">{t("settingsPostmark.step2.verifiedDomains")}</dt>
                <dd className="break-words text-foreground">{s.sender.verifiedDomains.length ? s.sender.verifiedDomains.join(", ") : t("settingsPostmark.step2.none")}</dd>
              </dl>
              <p className="text-xs text-muted-foreground">
                {t("settingsPostmark.step2.signBefore")}<strong>Sender Signatures</strong>{t("settingsPostmark.step2.signAfter")}<Link href="/admin/configuracion/dominios" className="text-primary underline-offset-4 hover:underline">{t("settingsPostmark.step2.signLink")}</Link>.
              </p>
              <Button variant="outline" disabled={!s.serverToken.set || verify.isPending} onClick={() => verify.mutate()}>
                {t("settingsPostmark.step2.test")}
              </Button>
              {verify.data && (
                <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
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
              <dl className="grid gap-2 text-sm">
                <dt className="text-muted-foreground">{t("settingsPostmark.step3.url")}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-muted px-2 py-1 text-xs text-foreground">{s.webhook.url ?? t("settingsPostmark.step3.noPublicUrl")}</code>
                  {s.webhook.url && (
                    <Button size="sm" variant="ghost" onClick={() => copy(t, s.webhook.url!, t("settingsPostmark.copyWhatUrl"))} aria-label={t("settingsPostmark.step3.copyUrl")}>
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                </dd>
                <dt className="text-muted-foreground">{t("settingsPostmark.step3.headerName")}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 text-xs text-foreground">{s.webhook.header}</code>
                  <Button size="sm" variant="ghost" onClick={() => copy(t, s.webhook.header, t("settingsPostmark.copyWhatHeader"))} aria-label={t("settingsPostmark.step3.copyHeader")}>
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </dd>
                <dt className="text-muted-foreground">{t("settingsPostmark.step3.headerValue")}</dt>
                <dd className="space-y-2">
                  {newWebhookToken ? (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="break-all rounded bg-muted px-2 py-1 text-xs text-foreground">{newWebhookToken}</code>
                        <Button size="sm" variant="ghost" onClick={() => copy(t, newWebhookToken, t("settingsPostmark.copyWhatToken"))} aria-label={t("settingsPostmark.step3.copyToken")}>
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                      <p className="text-xs text-warning">{t("settingsPostmark.step3.copyNow")}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{s.webhook.configured ? t("settingsPostmark.step3.generated") : t("settingsPostmark.step3.notGenerated")}</p>
                  )}
                  <Button size="sm" variant="outline" disabled={gen.isPending} onClick={() => gen.mutate()}>
                    <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {s.webhook.configured ? t("settingsPostmark.step3.genAnother") : t("settingsPostmark.step3.gen")}
                  </Button>
                </dd>
              </dl>
            </Step>

            <Step n={4} title={t("settingsPostmark.step4.title")}>
              {s.stats30d && Object.keys(s.stats30d).length ? (
                <ul className="flex flex-wrap gap-2 text-sm">
                  {Object.entries(s.stats30d).map(([k, n]) => (
                    <li key={k} className="rounded-full border border-border px-3 py-1 text-foreground">
                      {STAT_KEYS.includes(k) ? t(`settingsPostmark.stat.${k}`) : k}: <strong>{n}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" aria-hidden="true" /> {t("settingsPostmark.step4.empty")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{t("settingsPostmark.step4.detail")}</p>
            </Step>

            {s.configured && (
              <div className="flex justify-end">
                <Button variant="ghost" className="text-destructive" onClick={() => setConfirmOff(true)}>
                  <Unplug className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("settingsPostmark.disconnect")}
                </Button>
              </div>
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
