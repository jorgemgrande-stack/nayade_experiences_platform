import { useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Lock, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeIntegrationText } from "@shared/i18n/integrationsDe";

interface Mode {
  mode: "test" | "live";
  label: string;
  connectable: boolean;
  status: string;
  statusLabel: string;
  accountHint: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requirementsDue: string[];
  disabledReason: string | null;
  onlineEnabled: boolean;
  connectedAt: number | null;
  verifiedAt: number | null;
  lastEventAt: number | null;
  lastEventType: string | null;
  checkedAt?: number | null;
}

const STATUS_STYLE: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  no_conectada: { icon: CircleDashed, className: "text-muted-foreground" },
  pendiente: { icon: CircleDashed, className: "text-warning" },
  verificada: { icon: CheckCircle2, className: "text-success" },
  restringida: { icon: AlertTriangle, className: "text-danger" },
};

function ModeCard({ m, platformReady, onChanged }: { m: Mode; platformReady: boolean; onChanged: () => void }) {
  const { t, format, locale } = useI18n();
  const modeLabel = localizeIntegrationText(m.label, locale);
  const fmt = (ms: number | null) => (ms ? format.dateTime(ms, { dateStyle: "medium", timeStyle: "short" }) : "—");
  const isLive = m.mode === "live";
  const connect = trpc.cobros.connect.useMutation({
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (e) => toast.error(e.message),
  });
  // Modo Real: se vincula la cuenta de Stripe que la empresa YA tiene (no se crea ninguna)
  const connectLive = trpc.cobros.connectLive.useMutation({
    onSuccess: (r) => {
      window.location.href = r.url;
    },
    onError: (e) => toast.error(e.message),
  });
  const refresh = trpc.cobros.refresh.useMutation({
    onSuccess: () => {
      toast.success(t("settingsPayments.refreshed"));
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const setOnline = trpc.cobros.setOnline.useMutation({
    onSuccess: onChanged,
    onError: (e) => toast.error(e.message),
  });
  const s = STATUS_STYLE[m.status] ?? STATUS_STYLE.no_conectada;
  const Icon = s.icon;

  return (
    <section className="bg-card border border-border/50 rounded-xl p-5 space-y-4" aria-labelledby={`cobros-${m.mode}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`cobros-${m.mode}`} className="text-lg font-semibold">
            {modeLabel}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isLive ? t("settingsPayments.liveHint") : t("settingsPayments.testHint")}
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${s.className}`}>
          <Icon className="w-4 h-4" aria-hidden /> {localizeIntegrationText(m.statusLabel, locale)}
        </span>
      </div>

      {isLive && !m.connectable ? (
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <span>{t("settingsPayments.liveOff")}</span>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t(`settingsPayments.status.${STATUS_STYLE[m.status] ? m.status : "no_conectada"}`)}</p>
          {isLive && !m.accountHint && (
            <p className="text-sm text-muted-foreground">
              {t("settingsPayments.liveLinkInfo")}
            </p>
          )}
          {m.accountHint && (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">{t("settingsPayments.linkedAccount")}</dt>
              <dd className="font-mono">{m.accountHint}</dd>
              <dt className="text-muted-foreground">{t("settingsPayments.linkedOn")}</dt>
              <dd>{fmt(m.connectedAt)}</dd>
              <dt className="text-muted-foreground">{t("settingsPayments.canCharge")}</dt>
              <dd>{m.chargesEnabled ? t("settingsPayments.yes") : t("settingsPayments.no")}</dd>
              <dt className="text-muted-foreground">{t("settingsPayments.canPayout")}</dt>
              <dd>{m.payoutsEnabled ? t("settingsPayments.yes") : t("settingsPayments.no")}</dd>
              <dt className="text-muted-foreground">{t("settingsPayments.lastEvent")}</dt>
              <dd>{m.lastEventAt ? `${fmt(m.lastEventAt)} (${m.lastEventType})` : m.checkedAt ? t("settingsPayments.noEventChecked", { date: fmt(m.checkedAt) }) : t("settingsPayments.noEventYet")}</dd>
            </dl>
          )}
          {m.requirementsDue.length > 0 && (
            <div role="alert" className="text-sm rounded-xl border border-warning/40 bg-warning/10 p-3">
              {t("settingsPayments.requirementsDue", { n: m.requirementsDue.length })}
            </div>
          )}
          {m.disabledReason && (
            <div role="alert" className="text-sm rounded-xl border border-danger/40 bg-danger/10 p-3">
              {t("settingsPayments.disabledReason", { reason: m.disabledReason })}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {isLive ? (
              <Button onClick={() => connectLive.mutate()} disabled={connectLive.isPending} variant={m.status === "verificada" ? "outline" : "default"}>
                {connectLive.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {m.accountHint ? t("settingsPayments.reauthorize") : t("settingsPayments.linkAccount")}
              </Button>
            ) : (
              <Button onClick={() => connect.mutate()} disabled={!platformReady || connect.isPending} variant={m.status === "verificada" ? "outline" : "default"}>
                {connect.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {m.accountHint ? t("settingsPayments.continueReview") : t("settingsPayments.connectAccount")}
              </Button>
            )}
            {m.accountHint && (
              <Button variant="outline" onClick={() => refresh.mutate({ mode: m.mode })} disabled={refresh.isPending}>
                {refresh.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("settingsPayments.checkStatus")}
              </Button>
            )}
          </div>

          <div className="border-t border-border/50 pt-4">
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={m.onlineEnabled}
                disabled={setOnline.isPending || (!m.onlineEnabled && m.status !== "verificada")}
                onChange={(e) => setOnline.mutate({ mode: m.mode, enabled: e.target.checked })}
              />
              <span>
                <strong>{t("settingsPayments.chargeOnline", { label: modeLabel })}</strong>
                <br />
                <span className="text-muted-foreground">
                  {m.status === "verificada"
                    ? isLive
                      ? t("settingsPayments.onlineLive")
                      : t("settingsPayments.onlineTest")
                    : t("settingsPayments.onlineLater")}
                </span>
              </span>
            </label>
          </div>
        </>
      )}
    </section>
  );
}

export default function Cobros() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const status = trpc.cobros.status.useQuery();
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const back = params?.get("stripe");
  const refresh = trpc.cobros.refresh.useMutation({ onSettled: () => utils.cobros.status.invalidate() });
  const code = params?.get("code") ?? null;
  const oauthState = params?.get("state") ?? null;
  const oauthError = params?.get("error") ?? null;
  const completeLive = trpc.cobros.completeLive.useMutation({
    onSuccess: () => toast.success(t("settingsPayments.linked")),
    onError: (e) => toast.error(e.message),
    onSettled: () => {
      window.history.replaceState(null, "", window.location.pathname);
      utils.cobros.status.invalidate();
    },
  });

  // Al volver de Stripe se relee el estado real de la cuenta (la vuelta del navegador no prueba nada por sí sola)
  useEffect(() => {
    if (back === "volver" && status.data?.platformReady) refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back, status.data?.platformReady]);

  // Vuelta de la autorización de Stripe (modo Real): el código es de un solo uso y el servidor comprueba el state firmado
  useEffect(() => {
    if (oauthError) {
      toast.error(t("settingsPayments.authFailed"));
      window.history.replaceState(null, "", window.location.pathname);
    } else if (code && oauthState && !completeLive.isPending && !completeLive.isSuccess && !completeLive.isError) {
      completeLive.mutate({ code, state: oauthState });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, oauthState, oauthError]);

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t("settingsPayments.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("settingsPayments.intro")}
          </p>
        </div>

        {status.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : status.error ? (
          <div role="alert" className="flex items-start gap-2 text-sm text-danger">
            <XCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> {status.error.message}
          </div>
        ) : (
          status.data && (
            <>
              {!status.data.platformReady && (
                <div role="alert" className="text-sm rounded-xl border border-warning/40 bg-warning/10 p-3">
                  {t("settingsPayments.platformNotReady", { problem: status.data.platformProblem })}
                </div>
              )}
              {status.data.modes.map((m) => (
                <ModeCard key={m.mode} m={m} platformReady={status.data!.platformReady} onChanged={() => utils.cobros.status.invalidate()} />
              ))}
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden />
                {t("settingsPayments.footer")}
              </p>
            </>
          )
        )}
      </div>
    </AdminLayout>
  );
}
