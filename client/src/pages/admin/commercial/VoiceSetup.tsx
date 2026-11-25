/**
 * «Llamadas IA · Puesta en marcha» (Elephant Voice, capacidad voice-ai, solo administración): la empresa conecta su
 * propia cuenta de Vapi sin implantación técnica. Clave privada en la bóveda de la empresa (validada contra Vapi y nunca
 * mostrada), elección de asistente y número, configuración del webhook hacia el dominio de la empresa con una clave de
 * verificación de al menos 24 caracteres, y comprobación de la primera llamada. Cada paso se marca con datos reales
 * (voiceSetup.status). Las piezas visuales están en VoiceSetupParts.tsx.
 */
import { confirmAction } from "@/components/admin/ConfirmHost";
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { ChevronRight, PhoneCall, Rocket, ShieldCheck, Unplug } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { VOICE_CALLS_PATH } from "@shared/voiceSetup";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { HeroCard } from "@/components/admin/PanelVisual";
import { FormSection } from "../accounting/shared/EconomyUi";
import { ConnectCard, KeyCard, StepList, errMsg } from "./VoiceSetupParts";

export default function VoiceSetup() {
  const { t } = useI18n();
  const f = useFormat();
  const fmt = (iso: string | null | undefined) => (iso ? f.dateTime(iso, { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const q = trpc.voiceSetup.status.useQuery(undefined, { refetchInterval: 30_000 });
  const d = q.data;
  const [verifyOn, setVerifyOn] = useState(false);
  const verify = trpc.voiceSetup.verify.useQuery(undefined, { enabled: verifyOn, retry: false, refetchOnWindowFocus: false });
  const disconnect = trpc.voiceSetup.disconnect.useMutation();
  const keyOk = d?.steps.find((s) => s.id === "apiKey")?.status === "done";
  const connected = d?.steps.find((s) => s.id === "webhook")?.status === "done";
  const pct = d && d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
  const dt = "min-w-0";
  const dtCls = "text-xs text-muted-foreground";

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <PanelPageHeader className="mb-0" icon={<Rocket />} title={t("voiceSetup.title")} description={t("voiceSetup.description")} />

        {q.isLoading ? (
          <PanelLoading />
        ) : q.isError || !d ? (
          <PanelError title={t("voiceSetup.loadError")} error={q.error} onRetry={() => q.refetch()} />
        ) : !d.multi ? (
          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            {t("voiceSetup.notMulti")}{" "}
            <Link href={VOICE_CALLS_PATH} className="underline">{t("voiceSetup.notMultiLink")}</Link>.
          </div>
        ) : (
          <>
            <HeroCard>
              <div role="status" className="relative space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-semibold text-foreground">{d.ready ? t("voiceSetup.progress.ready") : t("voiceSetup.progress.notReady")}</p>
                  <span className="text-xs text-muted-foreground">{t("voiceSetup.progress.steps", { done: d.completed, total: d.total })}</span>
                </div>
                <div role="progressbar" aria-label={t("voiceSetup.progress.bar")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className={`h-full rounded-full ${d.ready ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
                {d.ready ? (
                  <p className="text-sm text-muted-foreground">{t("voiceSetup.progress.readyHint")}</p>
                ) : (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {d.missing.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                )}
              </div>
            </HeroCard>

            <StepList steps={d.steps} />

            <div className="grid gap-4 lg:grid-cols-2">
              <KeyCard masked={d.keyMasked} onChanged={() => q.refetch()} />
              <ConnectCard ready={keyOk} current={{ assistantId: d.assistant.id, phoneId: d.phoneNumber.id }} onChanged={() => q.refetch()} />
            </div>

            <FormSection title={t("voiceSetup.status.title")} description={t("voiceSetup.status.help")}>
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div className={dt}><dt className={dtCls}>{t("voiceSetup.status.assistant")}</dt><dd className="break-words">{d.assistant.name ?? "—"}</dd></div>
                <div className={dt}><dt className={dtCls}>{t("voiceSetup.status.number")}</dt><dd className="break-words">{d.phoneNumber.number ?? "—"}</dd></div>
                <div className={dt}>
                  <dt className={dtCls}>{t("voiceSetup.status.secret")}</dt>
                  <dd className="flex items-center gap-1">
                    <ShieldCheck className={`h-4 w-4 ${d.secret.usable ? "text-success" : "text-muted-foreground"}`} aria-hidden="true" />
                    {d.secret.usable ? t("voiceSetup.status.secretOk") : d.secret.tooShort ? t("voiceSetup.status.secretShort") : t("voiceSetup.status.secretNone")}
                  </dd>
                </div>
                <div className={`${dt} sm:col-span-2 lg:col-span-3`}><dt className={dtCls}>{t("voiceSetup.status.address")}</dt><dd className="break-all font-mono text-xs">{d.webhookUrl ?? t("voiceSetup.status.noAddress")}</dd></div>
                <div className={dt}><dt className={dtCls}>{t("voiceSetup.status.connectedAt")}</dt><dd>{fmt(d.connectedAt)}</dd></div>
                <div className={dt}><dt className={dtCls}>{t("voiceSetup.status.lastEvent")}</dt><dd>{fmt(d.lastEventAt)}</dd></div>
                <div className={dt}><dt className={dtCls}>{t("voiceSetup.status.lastCall")}</dt><dd>{d.lastCall ? `${fmt(d.lastCall.at)}${d.lastCall.durationSeconds != null ? ` · ${d.lastCall.durationSeconds} s` : ""}` : "—"}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!connected || verify.isFetching} onClick={() => (verifyOn ? verify.refetch() : setVerifyOn(true))} className="gap-1.5">
                  <PhoneCall className="h-4 w-4" aria-hidden="true" />{verify.isFetching ? t("voiceSetup.status.verifying") : t("voiceSetup.status.verify")}
                </Button>
                <Button type="button" variant="outline" onClick={() => q.refetch()}>{t("voiceSetup.status.refresh")}</Button>
                <Button asChild variant="outline"><Link href={VOICE_CALLS_PATH} className="inline-flex items-center gap-1">{t("voiceSetup.status.seeCalls")}<ChevronRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
              </div>
              {verifyOn && verify.data && (
                <div role="status" className={`text-sm ${verify.data.ok ? "text-success" : "text-danger"}`}>
                  {verify.data.ok ? t("voiceSetup.status.verifyOk") : (
                    <ul className="list-disc pl-5">{verify.data.problems.map((m) => <li key={m}>{m}</li>)}</ul>
                  )}
                </div>
              )}
              {verifyOn && verify.isError && <p role="alert" className="text-sm text-danger">{verify.error.message}</p>}
              <p className="text-xs text-muted-foreground">{t("voiceSetup.status.cost")}</p>
            </FormSection>

            {(d.keyMasked || d.secret.set || d.assistant.id) && (
              <FormSection title={t("voiceSetup.disconnect.title")} description={t("voiceSetup.disconnect.help")} className="border-danger/30">
                <Button
                  type="button"
                  variant="outline"
                  disabled={disconnect.isPending}
                  className="gap-1.5 border-danger/50 text-danger hover:text-danger"
                  onClick={async () => {
                    if (!(await confirmAction({ description: t("voiceSetup.disconnect.confirm"), destructive: true }))) return;
                    try {
                      await disconnect.mutateAsync();
                      setVerifyOn(false);
                      toast.success(t("voiceSetup.disconnect.ok"));
                      q.refetch();
                    } catch (err) {
                      toast.error(errMsg(err, t("voiceSetup.disconnect.error")));
                    }
                  }}
                >
                  <Unplug className="h-4 w-4" aria-hidden="true" />
                  {disconnect.isPending ? t("voiceSetup.disconnect.submitting") : t("voiceSetup.disconnect.submit")}
                </Button>
              </FormSection>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
