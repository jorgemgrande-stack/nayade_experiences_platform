/**
 * Dominio propio (/admin/configuracion/dominios): la empresa conecta su dominio en cinco pasos — dominio, titularidad
 * (TXT), registros DNS que pide la plataforma, certificado HTTPS y activación tras comprobar que la web responde.
 *
 * Todo lo decide el plano de control por el canal del Core (domains.*): qué permite el plan, los registros exactos (los
 * de Railway para ese dominio, nunca inventados) y cuándo queda activo. La dirección de la plataforma sigue siempre
 * disponible como respaldo.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Check, CheckCircle2, Circle, Copy, ExternalLink, Globe, Loader2, RefreshCw, ShieldCheck, Star, Unplug } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { PanelLoading, PanelError, PanelEmpty } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { localizeIntegrationText } from "@shared/i18n/integrationsDe";
import { type CustomDomainView, type DomainRecordView, type DomainStage } from "@shared/customDomains";

const STEPS = ["domain", "ownership", "dns", "certificate", "active"] as const;

/** Paso del asistente en el que está cada etapa (0-4). */
function stepOf(stage: DomainStage): number {
  switch (stage) {
    case "pending_verification":
      return 1;
    case "pending_dns":
      return 2;
    case "pending_certificate":
      return 3;
    case "checking":
    case "error":
      return 3;
    case "active":
      return 4;
    default:
      return 0;
  }
}

const STAGE_TONE: Record<DomainStage, string> = {
  pending_verification: "bg-warning/10 text-warning",
  pending_dns: "bg-warning/10 text-warning",
  pending_certificate: "bg-info/10 text-info",
  checking: "bg-info/10 text-info",
  active: "bg-success/10 text-success",
  error: "bg-danger/10 text-danger",
  disconnected: "bg-muted text-muted-foreground",
};

/** Etapas en las que el asistente vuelve a comprobar solo mientras la página está abierta. */
const AUTO_CHECK: ReadonlySet<DomainStage> = new Set<DomainStage>(["pending_verification", "pending_dns", "pending_certificate", "checking", "error"]);

function StageBadge({ stage }: { stage: DomainStage }) {
  const { t } = useI18n();
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STAGE_TONE[stage])}>{t(`settingsDomains.stage.${stage}`)}</span>;
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2 py-1.5 font-mono text-xs">{value}</code>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        aria-label={t("settingsDomains.copyLabel", { label })}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function RecordsTable({ records }: { records: DomainRecordView[] }) {
  const { t } = useI18n();
  if (records.length === 0) return null;
  return (
    <div className="space-y-3">
      {records.map((r) => (
        <div key={`${r.type}-${r.fqdn}-${r.value}`} className="rounded-lg border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono">{r.type}</Badge>
            <span className="text-xs text-muted-foreground">
              {r.purpose === "ownership" ? t("settingsDomains.purpose.ownership") : r.purpose === "traffic" ? t("settingsDomains.purpose.traffic") : t("settingsDomains.purpose.certificate")}
            </span>
            <span className={cn("ml-auto inline-flex items-center gap-1 text-xs font-medium", r.ok ? "text-success" : "text-muted-foreground")}>
              {r.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              {r.ok ? t("settingsDomains.detected") : t("settingsDomains.notDetected")}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[7rem_1fr] sm:items-center">
            <span className="text-xs font-medium text-muted-foreground">{t("settingsDomains.nameHost")}</span>
            <CopyValue value={r.name} label={t("settingsDomains.copyName")} />
            <span className="text-xs font-medium text-muted-foreground">{t("settingsDomains.valueTarget")}</span>
            <CopyValue value={r.value} label={t("settingsDomains.copyValue")} />
          </div>
          {r.name !== r.fqdn && <p className="mt-2 text-xs text-muted-foreground">{t("settingsDomains.fullName")}<span className="font-mono">{r.fqdn}</span></p>}
        </div>
      ))}
    </div>
  );
}

function Stepper({ current, done }: { current: number; done: boolean }) {
  const { t } = useI18n();
  return (
    <ol className="grid grid-cols-5 gap-1 sm:gap-2" aria-label={t("settingsDomains.stepsLabel")}>
      {STEPS.map((stepKey, i) => {
        const complete = i < current || (done && i === current);
        const active = i === current && !done;
        return (
          <li key={stepKey} className="flex flex-col items-center gap-1 text-center" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold",
                complete && "border-success/40 bg-success text-background",
                active && "border-primary bg-primary text-primary-foreground",
                !complete && !active && "text-muted-foreground",
              )}
            >
              {complete ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className={cn("text-xs leading-tight sm:text-xs", active ? "font-semibold" : "text-muted-foreground")}>{t(`settingsDomains.steps.${stepKey}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DomainWizard({ d, busy, onCheck, onPrimary, onDisconnect }: { d: CustomDomainView; busy: boolean; onCheck: () => void; onPrimary: () => void; onDisconnect: () => void }) {
  const { t, format, locale } = useI18n();
  const step = stepOf(d.stage);
  const traffic = d.records.filter((r) => r.purpose !== "ownership");
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="break-all text-lg">{d.domain}</CardTitle>
          <StageBadge stage={d.stage} />
          {d.primary && (
            <Badge variant="outline" className="gap-1">
              <Star className="h-3 w-3" /> {t("settingsDomains.primary")}
            </Badge>
          )}
        </div>
        {d.stage !== "disconnected" && <Stepper current={step} done={d.stage === "active"} />}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className={cn("text-sm", d.stage === "error" ? "text-danger" : "text-muted-foreground")} role="status">
          {localizeIntegrationText(d.message, locale)}
        </p>

        {d.stage === "pending_verification" && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("settingsDomains.step2.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("settingsDomains.step2.help")}
            </p>
            <RecordsTable records={d.records} />
          </div>
        )}

        {(d.stage === "pending_dns" || ((d.stage === "pending_certificate" || d.stage === "checking" || d.stage === "error") && traffic.length > 0)) && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("settingsDomains.step3.title", { domain: d.domain })}</h3>
            {traffic.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t(traffic.length === 1 ? "settingsDomains.step3.helpOne" : "settingsDomains.step3.helpMany", { domain: d.domain })}
                </p>
                <RecordsTable records={traffic} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("settingsDomains.step3.preparing")}</p>
            )}
            {d.apex && (
              <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                {t("settingsDomains.step3.apex", { domain: d.domain })}
              </p>
            )}
          </div>
        )}

        {(d.stage === "pending_certificate" || d.stage === "checking") && (
          <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("settingsDomains.step4")}</span>
          </div>
        )}

        {d.stage === "active" && (
          <div className="space-y-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4" /> {t("settingsDomains.step5", { domain: d.domain })}
            </p>
            {d.https && <p className="text-xs">{t("settingsDomains.lastCheck", { detail: d.https.detail, date: format.dateTime(d.https.checkedAt, { dateStyle: "short", timeStyle: "medium" }) })}</p>}
          </div>
        )}

        {/* Barra de acciones: lo destructivo y discreto a la izquierda, la acción principal a la derecha */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
          {d.stage !== "disconnected" && (
            <Button variant="ghost" className="text-danger hover:text-danger sm:mr-auto" onClick={onDisconnect} disabled={busy}>
              <Unplug className="mr-2 h-4 w-4" /> {d.stage === "active" ? t("settingsDomains.disconnect") : t("settingsDomains.cancelConnection")}
            </Button>
          )}
          {d.stage === "active" && (
            <>
              <Button variant="outline" asChild>
                <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" /> {t("settingsDomains.openSite")}
                </a>
              </Button>
              <Button variant="outline" onClick={onCheck} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} {t("settingsDomains.check")}
              </Button>
              {!d.primary && (
                <Button onClick={onPrimary} disabled={busy}>
                  <Star className="mr-2 h-4 w-4" /> {t("settingsDomains.usePrimary")}
                </Button>
              )}
            </>
          )}
          {d.stage !== "disconnected" && d.stage !== "active" && (
            <Button onClick={onCheck} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {d.stage === "pending_verification" ? t("settingsDomains.alreadyCreated") : t("settingsDomains.checkNow")}
            </Button>
          )}
        </div>
        {d.lastCheckedAt && <p className="text-xs text-muted-foreground">{t("settingsDomains.checkedAt", { date: format.dateTime(d.lastCheckedAt, { dateStyle: "short", timeStyle: "medium" }) })}</p>}
      </CardContent>
    </Card>
  );
}

export default function CustomDomains() {
  const { t, locale } = useI18n();
  const utils = trpc.useUtils();
  const status = trpc.domains.status.useQuery(undefined, { refetchOnWindowFocus: true, retry: 1 });
  const [domain, setDomain] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const refresh = () => void utils.domains.status.invalidate();
  const onError = (e: { message: string }) => toast.error(e.message);
  const add = trpc.domains.add.useMutation({
    onSuccess: (d) => {
      setDomain("");
      setSelected(d.domain);
      refresh();
    },
    onError,
  });
  const check = trpc.domains.check.useMutation({
    onSuccess: (d) => {
      if (d.stage === "active") toast.success(t("settingsDomains.isActive", { domain: d.domain }));
      refresh();
    },
    onError,
  });
  const primary = trpc.domains.setPrimary.useMutation({ onSuccess: () => (toast.success(t("settingsDomains.primaryUpdated")), refresh()), onError });
  const disconnect = trpc.domains.disconnect.useMutation({ onSuccess: () => (toast.success(t("settingsDomains.disconnected")), refresh()), onError });

  const overview = status.data?.available ? status.data.overview : null;
  const visible = useMemo(() => (overview?.domains ?? []).filter((d) => d.stage !== "disconnected"), [overview]);
  const disconnected = useMemo(() => (overview?.domains ?? []).filter((d) => d.stage === "disconnected"), [overview]);
  const current = visible.find((d) => d.domain === selected) ?? visible[0] ?? null;
  const busy = check.isPending || primary.isPending || disconnect.isPending;

  // Mientras la página está abierta y el dominio en curso no está activo, se vuelve a comprobar cada 30 s
  useEffect(() => {
    if (!current || !AUTO_CHECK.has(current.stage)) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !check.isPending) check.mutate({ domain: current.domain });
    }, 30_000);
    return () => clearInterval(timer);
  }, [current?.domain, current?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <PanelPageHeader title={t("settingsDomains.title")} description={t("settingsDomains.intro")} />

        {status.isLoading && <PanelLoading label={t("settingsDomains.loading")} />}
        {status.error && <PanelError error={status.error} onRetry={() => void status.refetch()} />}
        {status.data && !status.data.available && (
          <Card>
            <CardContent className="py-6 text-sm text-muted-foreground">{localizeIntegrationText(status.data.reason, locale)}</CardContent>
          </Card>
        )}

        {overview && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-4 w-4" /> {t("settingsDomains.addresses")}
                </CardTitle>
                <CardDescription>{t("settingsDomains.addressesHelp")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {overview.fallback && (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                    <span className="break-all font-mono text-sm">{overview.fallback}</span>
                    <Badge variant="secondary">{t("settingsDomains.platformAddress")}</Badge>
                    {overview.primary === overview.fallback ? (
                      <Badge variant="outline" className="gap-1">
                        <Star className="h-3 w-3" /> {t("settingsDomains.primary")}
                      </Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={() => primary.mutate({ domain: overview.fallback! })}>
                        {t("settingsDomains.useAsPrimary")}
                      </Button>
                    )}
                  </div>
                )}
                {visible.map((d) => (
                  <button
                    key={d.domain}
                    type="button"
                    onClick={() => setSelected(d.domain)}
                    className={cn("flex w-full flex-wrap items-center gap-2 rounded-md border p-3 text-left transition-colors hover:bg-muted/60", current?.domain === d.domain && "border-primary ring-1 ring-primary")}
                  >
                    <span className="break-all font-mono text-sm">{d.domain}</span>
                    <StageBadge stage={d.stage} />
                    {d.primary && (
                      <Badge variant="outline" className="gap-1">
                        <Star className="h-3 w-3" /> {t("settingsDomains.primary")}
                      </Badge>
                    )}
                  </button>
                ))}
              </CardContent>
            </Card>

            {current && (
              <DomainWizard
                d={current}
                busy={busy}
                onCheck={() => check.mutate({ domain: current.domain })}
                onPrimary={() => primary.mutate({ domain: current.domain })}
                onDisconnect={() => setConfirm(current.domain)}
              />
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{visible.length === 0 ? t("settingsDomains.step1Title") : t("settingsDomains.connectAnother")}</CardTitle>
                <CardDescription>
                  {t("settingsDomains.recommendBefore")}<span className="font-mono">www.tuempresa.es</span>{t("settingsDomains.recommendAfter")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {overview.allowance.allowed ? (
                  <form
                    className="flex flex-col gap-2 sm:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (domain.trim()) add.mutate({ domain: domain.trim() });
                    }}
                  >
                    <div className="space-y-1.5 sm:flex-1">
                      <Label htmlFor="dominio-nuevo" className="text-sm font-medium">{t("settingsDomains.domainAria")}</Label>
                      <Input id="dominio-nuevo" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="www.tuempresa.es" autoComplete="off" spellCheck={false} inputMode="url" />
                    </div>
                    <Button type="submit" disabled={add.isPending || !domain.trim()} className="sm:self-end">
                      {add.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t("settingsDomains.continue")}
                    </Button>
                  </form>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p className="text-muted-foreground">{localizeIntegrationText(overview.allowance.reason, locale)}</p>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/admin/suscripcion">{t("settingsDomains.viewPlan")}</Link>
                    </Button>
                  </div>
                )}
                {overview.allowance.max !== null && overview.allowance.max > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("settingsDomains.inUse", { used: overview.allowance.used, max: overview.allowance.max })}
                  </p>
                )}
              </CardContent>
            </Card>

            {disconnected.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("settingsDomains.disconnectedList", { list: disconnected.map((d) => d.domain).join(", ") })}
              </p>
            )}
          </>
        )}
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settingsDomains.confirm.title", { domain: confirm })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settingsDomains.confirm.text")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("settingsDomains.confirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (confirm) disconnect.mutate({ domain: confirm });
                setConfirm(null);
              }}
            >
              {t("settingsDomains.confirm.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
