/**
 * «Primeros pasos»: asistente de configuración inicial de la empresa.
 *
 * El progreso se guarda en el servidor (por empresa): se puede dejar a medias, volver atrás, corregir y continuar
 * después, en cualquier navegador. El recorrido lo calcula el servidor (`plan`): solo los pasos de lo contratado, en
 * orden de negocio, y cada paso se marca solo cuando el dato existe de verdad. Al terminar u omitir un paso se pasa al
 * siguiente pendiente: lo hecho no se repite. Ningún paso bloquea el uso del sistema.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle, Blocks, Briefcase, Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, FileText, Globe, Hand, HelpCircle,
  Landmark, Loader2, Mail, Package, Palette, PartyPopper, ShoppingCart, SkipForward, Star, UserPlus, Users,
} from "lucide-react";
import { BrandIdentityEditor } from "@/components/brand/BrandIdentityEditor";
import { useI18n } from "@/i18n/I18nProvider";
import { activityInfo, configurationStepNumber, configurationSteps, nextOpenStep, type SetupStep } from "@shared/setupWizard";
import {
  ActivityStep, ClientStep, CommsStep, DocumentStep, FinishStep, FiscalStep, IdentityStep, ProductStep, SaleStep, SectorStep, WebStep, WelcomeStep, errMsg, useStepLabels,
} from "./PrimerosPasosSteps";

const ICONS: Record<SetupStep, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  welcome: Hand,
  company: Building2,
  fiscal: Landmark,
  brand: Palette,
  activity: Briefcase,
  client: Users,
  product: Package,
  web: Globe,
  operation: ShoppingCart,
  document: FileText,
  comms: Mail,
  sector: Blocks,
  finish: PartyPopper,
  users: UserPlus,
};

const PLAN_NAMES: Record<string, string> = { essential: "Essential", business: "Business", enterprise: "Enterprise" };

export default function PrimerosPasos() {
  const { t } = useI18n();
  const labels = useStepLabels();
  const HELP: Record<SetupStep, string> = {
    welcome: t("setup.help.welcome"),
    company: t("setup.help.company"),
    fiscal: t("setup.help.fiscal"),
    brand: t("setup.help.brand"),
    activity: t("setup.help.activity"),
    client: t("setup.help.client"),
    product: t("setup.help.product"),
    web: t("setup.help.web"),
    operation: t("setup.help.operation"),
    document: t("setup.help.document"),
    comms: t("setup.help.comms"),
    sector: t("setup.help.sector"),
    finish: t("setup.help.finish"),
    users: t("setup.help.users"),
  };
  const utils = trpc.useUtils();
  const sub = usePanelSubscription();
  const status = trpc.setupWizard.status.useQuery(undefined, { retry: false });
  const [current, setCurrent] = useState<SetupStep | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Al cargar, se continúa por el primer paso pendiente (reanudación)
  useEffect(() => {
    if (current || !status.data) return;
    setCurrent(status.data.nextStep ?? "finish");
  }, [status.data, current]);
  // El foco va al título del paso al cambiar (lectores de pantalla y teclado)
  useEffect(() => {
    headingRef.current?.focus();
  }, [current]);

  const setStep = trpc.setupWizard.setStep.useMutation({
    onSuccess: () => utils.setupWizard.status.invalidate(),
    onError: (e) => toast.error(errMsg(e, t("setup.saveFail"))),
  });

  if (status.isLoading || (!current && !status.error)) {
    return (
      <AdminLayout title={t("setup.title")}>
        <div className="flex items-center gap-2 p-8 text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("setup.loading")}
        </div>
      </AdminLayout>
    );
  }
  if (status.error || !status.data || !current) {
    return (
      <AdminLayout title={t("setup.title")}>
        <div role="alert" className="m-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          {t("setup.loadError", { message: status.error?.message ?? t("setup.retryHint") })}
        </div>
      </AdminLayout>
    );
  }

  const d = status.data;
  const readOnly = d.licence.readOnly;
  const steps = d.plan.steps;
  // Un paso que ya no se ve (p. ej. se dejó de contratar) lleva al resumen
  const shown: SetupStep = steps.some((s) => s.id === current) ? current : "finish";
  const idx = Math.max(0, steps.findIndex((s) => s.id === shown));
  const step = steps[idx];
  const go = (s: SetupStep) => setCurrent(s);
  // Siguiente PENDIENTE sobre el plan recién leído del servidor (tras guardar, el paso guardado y otros pueden haber
  // quedado hechos): lo hecho o lo omitido no se vuelve a mostrar
  const goNext = async () => {
    const fresh = await utils.setupWizard.status.fetch().catch(() => null);
    setCurrent(nextOpenStep(fresh?.plan.steps ?? steps, shown));
  };
  const goPrev = () => setCurrent(steps[Math.max(idx - 1, 0)].id);
  // Pasos «de hacer»: el dato real los completa; aun así queda registrado el avance
  const advance = (s: SetupStep) => async () => {
    if (!readOnly) await setStep.mutateAsync({ step: s, status: "done" }).catch(() => undefined);
    await utils.setupWizard.status.invalidate();
    await goNext();
  };
  const mark = async (s: SetupStep, st: "done" | "skipped") => {
    await setStep.mutateAsync({ step: s, status: st });
    if (s !== "finish") await goNext();
  };
  // Marca y colores: hecho solo con el logotipo subido; seguir sin él queda como omitido (se puede retomar)
  const afterBrand = async () => {
    await utils.setupWizard.status.invalidate();
    const fresh = await utils.setupWizard.status.fetch().catch(() => null);
    const done = fresh?.plan.steps.find((x) => x.id === "brand")?.status === "done";
    await mark("brand", done ? "done" : "skipped").catch(() => undefined);
  };
  const Icon = ICONS[shown];
  const activity = activityInfo(d.activity);
  const can = (cap: string) => sub.can(cap);
  const planName = d.licence.plan ? PLAN_NAMES[d.licence.plan] ?? null : null;
  // Un único número en todo el recorrido: la bienvenida y el resumen no son pasos de configuración
  const configCount = configurationSteps(steps).length;
  const stepNumber = configurationStepNumber(steps, shown);

  return (
    <AdminLayout title={t("setup.title")}>
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-foreground sm:text-2xl">{t("setup.heading")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("setup.intro", { count: configCount })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {planName && (
                <p className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
                  {t("setup.planLabel")} <strong className="text-foreground">{planName}</strong>
                  {d.licence.daysLeft !== null && !readOnly && <> · {t("setup.trial", { days: d.licence.daysLeft })}</>}
                </p>
              )}
              <Link href="/admin" className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                {t("setup.later")}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Progress value={d.plan.percent} className="h-2" aria-label={t("setup.progressAria")} aria-valuetext={t("setup.percentDone", { percent: d.plan.percent })} />
            <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">{d.plan.percent}%</span>
          </div>
          {readOnly && (
            <div role="alert" className="flex gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm text-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <p>{t("setup.readOnlyBanner")}</p>
            </div>
          )}
        </header>

        {/* minmax(0,1fr): en móvil el índice de pasos (desplazable) no puede ensanchar la columna ni la página */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label={t("setup.stepsNav")} className="min-w-0">
            {/* relative: los textos solo para lectores de pantalla (sr-only, absolutos) quedan dentro de la franja desplazable */}
            <ol className="relative flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {steps.map((s) => {
                const active = s.id === shown;
                const n = configurationStepNumber(steps, s.id);
                const StepIcon = ICONS[s.id];
                return (
                  <li key={s.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => go(s.id)}
                      aria-current={active ? "step" : undefined}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          s.status === "done" ? "bg-success text-background" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}
                        aria-hidden="true"
                      >
                        {s.status === "done" ? <Check className="h-3.5 w-3.5" /> : s.status === "skipped" ? <SkipForward className="h-3 w-3" /> : n ?? <StepIcon className="h-3 w-3" />}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {labels[s.id].title}
                        {s.recommended && s.status !== "done" && <Star className="h-3 w-3 text-warning" aria-hidden="true" />}
                        <span className="sr-only">
                          {" "}{s.status === "done" ? t("setup.statusDone") : s.status === "skipped" ? t("setup.statusSkipped") : t("setup.statusPending")}
                          {s.recommended ? ", " + t("setup.recommendedSr") : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <section aria-labelledby="paso-actual" className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {stepNumber !== null ? t("setup.stepOf", { n: stepNumber, total: configCount }) : shown === "welcome" ? t("setup.beforeStart") : t("setup.toFinish")}
                  {step?.recommended && <> {t("setup.recommendedDot")}</>}
                </p>
                <h2 id="paso-actual" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
                  {shown === "welcome" ? t("setup.welcomeTitle") : labels[shown].title}
                </h2>
                <p className="text-sm text-muted-foreground">{labels[shown].summary}</p>
              </div>
            </div>

            <details className="mb-5 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              <summary className="flex cursor-pointer items-center gap-2 font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <HelpCircle className="h-4 w-4" aria-hidden="true" /> {t("setup.whyTitle")}
              </summary>
              <p className="mt-2 text-muted-foreground">{HELP[shown]}</p>
            </details>

            {/* key: al volver a un paso se parte de los datos guardados */}
            <div key={shown}>
              {shown === "welcome" && <WelcomeStep tradeName={d.company.tradeName} planName={planName} steps={steps} disabled={setStep.isPending || readOnly} onStart={() => void mark("welcome", "done")} />}
              {shown === "company" && <IdentityStep initial={d.company} done={step?.status === "done"} disabled={readOnly} onSaved={() => void goNext()} />}
              {shown === "fiscal" && <FiscalStep initial={d.company} country={d.company.country} done={step?.status === "done"} fiscalFromRegistry={d.fiscalFromRegistry} disabled={readOnly} onSaved={() => void goNext()} />}
              {shown === "brand" &&
                (readOnly ? (
                  <p className="text-sm text-muted-foreground">{t("setup.brandReadOnly")}</p>
                ) : (
                  <>
                    {step?.status !== "done" && <p className="mb-4 text-sm text-muted-foreground">{t("setup.brandHint")}</p>}
                    <BrandIdentityEditor variant="onboarding" onSaved={() => void afterBrand()} />
                  </>
                ))}
              {shown === "activity" && <ActivityStep initial={d.activity} allowed={d.activities} disabled={readOnly} onSaved={() => void goNext()} />}
              {shown === "client" && <ClientStep noun={activity.clientNoun} count={d.facts.clients} disabled={readOnly || !sub.canWrite("crm-contacts")} onDone={advance("client")} />}
              {shown === "product" && (
                <ProductStep noun={activity.productNoun} example={activity.productExample} currency={d.company.currency || "EUR"} count={d.facts.products} disabled={readOnly || !sub.canWrite("shop-catalog")} onDone={advance("product")} />
              )}
              {shown === "web" && <WebStep done={step?.status === "done"} onContinue={advance("web")} legalMissing={d.legalMissing ?? []} />}
              {shown === "operation" && <SaleStep count={d.facts.sales} can={can} onDone={advance("operation")} />}
              {shown === "document" && <DocumentStep count={d.facts.documents} can={can} disabled={readOnly || !sub.canWrite("crm-quotes")} onDone={advance("document")} />}
              {shown === "comms" && <CommsStep initial={d.comms} tradeName={d.company.tradeName} done={step?.status === "done"} can={can} disabled={readOnly} onSaved={() => void goNext()} />}
              {shown === "sector" && <SectorStep modules={d.sectorModules} disabled={setStep.isPending || readOnly} onDone={() => void mark("sector", "done")} />}
              {shown === "finish" && <FinishStep steps={steps} completedAt={d.progress.completedAt} showTeam={!d.plan.hidden.includes("users") && can("admin-users")} disabled={readOnly} onGo={go} />}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <Button type="button" variant="ghost" onClick={goPrev} disabled={idx === 0}>
                <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" /> {t("setup.back")}
              </Button>
              <div className="flex flex-wrap gap-2">
                {shown !== "finish" && shown !== "welcome" && step?.status !== "done" && (
                  <Button type="button" variant="outline" disabled={setStep.isPending || readOnly} onClick={() => void mark(shown, "skipped")}>
                    {t("setup.skip")}
                  </Button>
                )}
                {shown !== "finish" && step?.status === "done" && (
                  <Button type="button" variant="outline" onClick={() => void goNext()}>
                    {t("setup.next")} <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </Button>
                )}
                {shown === "finish" && !d.progress.completedAt && (
                  <Button type="button" disabled={setStep.isPending || readOnly} onClick={() => void mark("finish", "done").then(() => toast.success(t("setup.launched")))}>
                    <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> {t("setup.launch")}
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}
