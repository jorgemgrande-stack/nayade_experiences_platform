/**
 * Suscripción de la empresa (/admin/suscripcion) con el sistema visual del marketplace (/admin/ampliar):
 *  1. Cabecera compacta: plan, estado real, fecha, cobro, datos y acción principal (shared/subscriptionHeader.ts).
 *  2. Planes (#planes): tarjetas y comparativa completa del catálogo publicado (PlanComparison).
 *  3. Contratación desde la prueba (#contratar): tres pasos con resumen (ConversionSection).
 *  4. Amplía tu plataforma (#ampliar): el puente con el marketplace, con sus mismas tarjetas (GrowSection).
 *  5. Detalle (#detalle, #facturacion): funcionalidades, límites y consumo, módulos, facturación y contrato, datos.
 *
 * Todo se lee del servidor (subscription.*, connect.catalog); aquí no se calcula ningún precio ni se decide quién puede
 * contratar. Rutas y anclas compatibles con los avisos del panel y el marketplace: #planes, ?contratar=<plan>[&modulos=]#contratar.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearch } from "wouter";
import { ArrowUpRight, CheckCircle2, Clock, Eye, Info, Layers, ShieldAlert, Sparkles } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import type { Translate } from "@shared/i18n/core";
import { useI18n } from "@/i18n/I18nProvider";
import { usePanelText } from "@/i18n/usePanelText";
import { WithdrawalSection } from "./WithdrawalSection";
import { PlanContractSection } from "./PlanContractSection";
import { ConversionSection, type ConversionRequest } from "./ConversionSection";
import { CancellationSection, PlanChangeSection } from "./SelfServiceSection";
import { PlanAssurances, PlanComparison } from "./PlanComparison";
import { PlanRequestList } from "./PlanRequests";
import { GrowSection, OwnedModules } from "./GrowSection";
import { UsageSection } from "./UsagePage";
import { SubscriptionHero } from "./SubscriptionHero";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { buildPlanComparison, isTrialState, parsePanelPlans, type PlanChangeInfo, type SelfServicePlanKey } from "@shared/subscriptionPlans";
import { parseConversionRequest } from "@shared/connectMarketplace";
import { expiredCanConsult } from "@shared/subscriptionRecovery";
import { subscriptionHeader, type HeaderAction } from "@shared/subscriptionHeader";
import "@/components/connect/connectStage.css";
import "./subscriptionStage.css";

/** Portal de facturación de Stripe: solo la persona propietaria y si está activado. */
function useBillingPortal() {
  const status = trpc.subscription.billingPortalStatus.useQuery(undefined, { retry: false, staleTime: 300_000 });
  const open = trpc.subscription.billingPortal.useMutation({
    onSuccess: (r) => window.location.assign((r as { url: string }).url),
    onError: (e) => toast.error(e.message),
  });
  return { enabled: !!status.data?.enabled, open };
}

/** Facturas de la suscripción en el portal de Stripe (pestaña de facturación). */
function BillingPortalSection() {
  const { t } = useI18n();
  const portal = useBillingPortal();
  if (!portal.enabled) return null;
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="sub-invoices">
      <h3 id="sub-invoices" className="font-semibold text-foreground">
        {t("subscription.page.invoicesTitle")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("subscription.page.invoicesText")}</p>
      <Button type="button" variant="outline" disabled={portal.open.isPending} onClick={() => portal.open.mutate()}>
        {portal.open.isPending ? t("subscription.common.opening") : t("subscription.page.invoicesBtn")}
        <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
      </Button>
    </section>
  );
}

const groupLabels = (t: Translate): Record<string, string> => ({
  crm: t("subscription.page.groups.crm"),
  ecommerce: t("subscription.page.groups.ecommerce"),
  cms: t("subscription.page.groups.cms"),
  billing: t("subscription.page.groups.billing"),
  admin: t("subscription.page.groups.admin"),
  comms: t("subscription.page.groups.comms"),
  automation: t("subscription.page.groups.automation"),
  business: t("subscription.page.groups.business"),
  enterprise: t("subscription.page.groups.enterprise"),
  finance: t("subscription.page.groups.finance"),
  ai: t("subscription.page.groups.ai"),
  marketing: t("subscription.page.groups.marketing"),
  operations: t("subscription.page.groups.operations"),
  net: t("subscription.page.groups.net"),
});

const capStatus = (t: Translate): Record<string, { label: string; icon: typeof CheckCircle2; tone: string }> => ({
  active: { label: t("subscription.page.cap.active"), icon: CheckCircle2, tone: "text-success" },
  read_only: { label: t("subscription.page.cap.readOnly"), icon: Eye, tone: "text-warning" },
  expired: { label: t("subscription.page.cap.expired"), icon: Eye, tone: "text-warning" },
  contracted: { label: t("subscription.page.cap.contracted"), icon: Clock, tone: "text-muted-foreground" },
  pending_setup: { label: t("subscription.page.cap.pendingSetup"), icon: Clock, tone: "text-muted-foreground" },
  suspended: { label: t("subscription.page.cap.suspended"), icon: ShieldAlert, tone: "text-danger" },
  cancelled: { label: t("subscription.page.cap.cancelled"), icon: ShieldAlert, tone: "text-muted-foreground" },
});

/** Capacidad caducada sin consulta (p. ej. el plazo de solo lectura vencido: decide() tampoco deja leer). */
const expiredNoRead = (t: Translate) => ({ label: t("subscription.page.cap.expiredNoRead"), icon: Clock, tone: "text-muted-foreground" });

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }));

const TABS = ["features", "limits", "modules", "billing", "data"] as const;
type DetailTab = (typeof TABS)[number];

export default function SubscriptionPage() {
  const { t } = useI18n();
  const px = usePanelText();
  const GROUP_LABELS = groupLabels(t);
  const CAP_STATUS = capStatus(t);
  const sub = usePanelSubscription();
  const data = sub.data;
  const { user } = useAuth();
  const isAdmin = (user as { role?: string } | null)?.role === "admin";
  const licensed = data?.licensing === "capabilities";
  const trial = !!data && (!!data.trial || isTrialState(data.state));

  // Contrato, opciones de compra y planes publicados: el servidor decide qué aplica a esta persona (null = no aplica)
  const contract = trpc.subscription.plan.useQuery(undefined, { retry: false, staleTime: 60_000, enabled: licensed });
  const conversion = trpc.subscription.conversionStatus.useQuery(undefined, { retry: false, staleTime: 60_000, enabled: licensed });
  const planChange = trpc.subscription.planChangeStatus.useQuery(undefined, { retry: false, staleTime: 60_000, enabled: licensed });
  const catalog = trpc.subscription.catalog.useQuery(undefined, { retry: false, staleTime: 60_000, enabled: licensed });
  const planRequests = trpc.subscription.planRequests.useQuery(undefined, { retry: false, staleTime: 60_000, enabled: licensed });
  const portal = useBillingPortal();
  const [requested, setRequested] = useState<ConversionRequest | null>(null);
  const [tab, setTab] = useState<DetailTab>("features");
  // «Contratar ahora» desde el marketplace: /admin/suscripcion?contratar=<plan>&modulos=<clave>#contratar
  const search = useSearch();
  useEffect(() => {
    const r = parseConversionRequest(search);
    if (r) setRequested({ plan: r.plan, modules: r.modules, at: Date.now() });
  }, [search]);

  const plans = useMemo(() => parsePanelPlans((catalog.data as { plans?: unknown } | null | undefined)?.plans), [catalog.data]);
  const pc = (planChange.data ?? null) as PlanChangeInfo | null;
  // ¿Contratación aceptada durante la prueba? (fuentes reales del servidor; cualquier empresa)
  const contracting = ((contract.data as { customTerms?: { contracting?: { acceptedAt?: number | null } | null } | null } | null | undefined)?.customTerms?.contracting) ?? null;
  const hasContracted = trial && !!contracting && contracting.acceptedAt != null;
  const cards = useMemo(
    // Con una contratación ya formalizada durante la prueba, las tarjetas no ofrecen contratar de nuevo
    () => (data ? buildPlanComparison({ plans, currentPlanKey: data.plan?.key ?? null, state: data.state, isAdmin, conversion: hasContracted ? null : (conversion.data ?? null), planChange: pc }) : []),
    [plans, data, isAdmin, conversion.data, pc, hasContracted],
  );
  const conversionOn = !!conversion.data?.enabled;
  const header = useMemo(
    () =>
      // La administración espera al contrato (cobro, renovación): así la cabecera no cambia de estado al cargar
      data && licensed && !(isAdmin && contract.isLoading)
        ? subscriptionHeader({
            overview: { licensing: data.licensing, state: data.state, plan: data.plan, trial: data.trial, consultation: data.consultation },
            contract: contract.data ?? null,
            isAdmin,
            portalEnabled: portal.enabled,
            conversionEnabled: conversionOn,
            hasPlans: cards.length > 0,
          })
        : null,
    [data, licensed, contract.data, contract.isLoading, isAdmin, portal.enabled, conversionOn, cards.length],
  );

  // Anclas de los avisos del panel y del marketplace: #planes («Reactivar mi plan»), #facturacion y #sub-cancel (cobro y
  // baja), #ampliar y #contratar (sin elección en la URL); se desplaza cuando el contenido ya está pintado
  const hashDone = useRef(false);
  useEffect(() => {
    if (hashDone.current || !data) return;
    const h = window.location.hash;
    if (h === "#planes" && cards.length > 0) {
      hashDone.current = true;
      scrollTo("planes");
    } else if (h === "#facturacion" || h === "#sub-cancel") {
      hashDone.current = true;
      setTab("billing");
      // La sección de baja se monta al abrir la pestaña y tras su consulta: se espera un momento
      window.setTimeout(() => (h === "#sub-cancel" && document.getElementById("sub-cancel") ? scrollTo("sub-cancel") : scrollTo("detalle")), 400);
    } else if (h === "#ampliar") {
      hashDone.current = true;
      scrollTo("ampliar");
    } else if (h === "#contratar" && !parseConversionRequest(window.location.search) && document.getElementById("contratar")) {
      hashDone.current = true;
      scrollTo("contratar");
    }
  }, [cards.length, data, conversion.data]);

  const onConvert = (plan: SelfServicePlanKey) => {
    setRequested({ plan, at: Date.now() });
    scrollTo("contratar");
  };
  const onHeader = (a: HeaderAction) => {
    if (a.kind === "convert") scrollTo("contratar");
    else if (a.kind === "plans") scrollTo("planes");
    else if (a.kind === "portal") portal.open.mutate();
    else if (a.kind === "billing") {
      setTab("billing");
      scrollTo("detalle");
    }
  };

  return (
    <AdminLayout>
      <div className="cx-stage cx-market -m-4 min-h-full p-4 sm:-m-6 sm:p-6">
        <div className="mx-auto max-w-7xl space-y-10">
          <SubscriptionHero model={header} planKey={data?.plan?.key ?? null} onAction={onHeader} busy={portal.open.isPending ? "portal" : null} />

          {sub.isLoading && <PanelLoading label={t("subscription.page.loading")} />}
          {sub.isError && <PanelError error={sub.error} onRetry={() => sub.refetch()} title={t("subscription.page.loadError")} />}

          {data && data.licensing === "legacy" && (
            <section className="flex gap-3 rounded-xl border border-border bg-card p-6" aria-labelledby="sub-legacy">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <h2 id="sub-legacy" className="font-semibold text-foreground">
                  {t("subscription.page.legacyTitle")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("subscription.page.legacyText")}
                </p>
              </div>
            </section>
          )}

          {data && licensed && (
            <>
              {/* Planes publicados */}
              <section id="planes" className="scroll-mt-4 space-y-6" aria-labelledby="sub-plans">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div className="min-w-0 max-w-3xl space-y-1">
                    <p className="cx-red-text inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("subscription.page.plansEyebrow")}
                    </p>
                    <h2 id="sub-plans" className="text-balance text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                      {hasContracted ? px("Comparación de planes") : trial ? t("subscription.page.plansTitleTrial") : t("subscription.page.plansTitle")}
                    </h2>
                    <p className="text-pretty text-sm text-muted-foreground sm:text-base">
                      {hasContracted ? px("Tu contratación ya está formalizada: esta comparación es solo informativa y no hace falta que contrates de nuevo.") : trial ? t("subscription.page.plansIntroTrial") : t("subscription.page.plansIntro")}
                    </p>
                  </div>
                  {!hasContracted && <PlanAssurances trial={trial} />}
                </div>
                {catalog.isLoading && <PanelLoading label={t("subscription.page.plansLoading")} />}
                {catalog.isError && <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title={t("subscription.page.plansLoadError")} />}
                {catalog.isSuccess && cards.length === 0 && (
                  <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                    {t("subscription.page.comparisonUnavailable")}{" "}
                    {data.upgradeUrl ? (
                      <a href={data.upgradeUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
                        {t("subscription.page.plansOnWeb")}
                      </a>
                    ) : (
                      t("subscription.page.askCommercial")
                    )}
                  </p>
                )}
                {cards.length > 0 && (
                  <>
                    <PlanComparison cards={cards} currentKey={data.plan?.key ?? null} requests={planRequests.data} current={pc?.current ?? null} onConvert={onConvert} />
                    <PlanRequestList requests={planRequests.data ?? []} />
                    <p className="text-xs text-muted-foreground">{t("subscription.page.pricesNote")}</p>
                  </>
                )}
              </section>

              {/* Contratar desde la prueba (solo administración; el servidor decide si está disponible) */}
              {trial && !hasContracted && <ConversionSection requested={requested} currentPlan={data.plan?.key ?? null} plans={plans} />}

              <GrowSection />

              {/* Detalle organizado en pestañas */}
              <section id="detalle" aria-labelledby="sub-detail" className="scroll-mt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span aria-hidden="true" data-tone="night" className="cx-tone-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-lg shadow-black/20 sm:h-12 sm:w-12">
                    <Layers className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <h2 id="sub-detail" className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                      {t("subscription.page.detailTitle")}
                    </h2>
                    <p className="text-sm text-muted-foreground">{t("subscription.page.detailText")}</p>
                  </div>
                </div>
                <span id="facturacion" className="block scroll-mt-4" aria-hidden="true" />
                <Tabs value={tab} onValueChange={(v) => setTab(v as DetailTab)} className="gap-4">
                  <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-xl p-1">
                    <TabsTrigger value="features" className="flex-none rounded-xl px-3 py-1.5">
                      {t("subscription.page.tabs.features")}
                    </TabsTrigger>
                    <TabsTrigger value="limits" className="flex-none rounded-xl px-3 py-1.5">
                      {t("subscription.page.tabs.limits")}
                    </TabsTrigger>
                    <TabsTrigger value="modules" className="flex-none rounded-xl px-3 py-1.5">
                      {t("subscription.page.tabs.modules")}
                    </TabsTrigger>
                    <TabsTrigger value="billing" className="flex-none rounded-xl px-3 py-1.5">
                      {t("subscription.page.tabs.billing")}
                    </TabsTrigger>
                    <TabsTrigger value="data" className="flex-none rounded-xl px-3 py-1.5">
                      {t("subscription.page.tabs.data")}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="features" className="rounded-xl border border-border bg-card p-5 sm:p-6">
                    <h3 className="mb-1 font-semibold text-foreground">{t("subscription.page.featuresTitle")}</h3>
                    <p className="mb-4 text-sm text-muted-foreground">{t("subscription.page.featuresText")}</p>
                    {data.capabilities.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">{t("subscription.page.featuresEmpty")}</p>
                    ) : (
                      <>
                      <ul className="mb-4 flex flex-wrap gap-2" aria-label={t("subscription.page.featuresTitle")}>
                        {Object.entries(
                          data.capabilities.reduce<Record<string, number>>((acc, cap) => {
                            const k = cap.status === "expired" && !expiredCanConsult(data.consultation) ? "expiredNoRead" : cap.status;
                            acc[k] = (acc[k] ?? 0) + 1;
                            return acc;
                          }, {}),
                        ).map(([k, n]) => {
                          const meta = k === "expiredNoRead" ? expiredNoRead(t) : (CAP_STATUS[k] ?? CAP_STATUS.contracted);
                          const SIcon = meta.icon;
                          return (
                            <li key={k} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1 text-xs font-medium text-foreground">
                              <SIcon className={cn("h-3.5 w-3.5", meta.tone)} aria-hidden="true" />
                              <strong className="font-semibold">{n}</strong> {meta.label}
                            </li>
                          );
                        })}
                      </ul>
                      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {Object.entries(
                          data.capabilities.reduce<Record<string, typeof data.capabilities>>((acc, cap) => {
                            (acc[cap.group] ??= []).push(cap);
                            return acc;
                          }, {}),
                        ).map(([group, caps]) => (
                          <div key={group} className="min-w-0 rounded-xl border border-border bg-background/40 p-4">
                            <h4 className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              <span className="min-w-0 break-words">{GROUP_LABELS[group] ?? group}</span>
                              <span className="rounded-full bg-muted px-2 py-0.5 tabular-nums text-foreground">{caps.length}</span>
                            </h4>
                            <ul className="space-y-1.5">
                              {caps.map((cap) => {
                                // «Caducada (solo lectura)» solo si hoy se puede consultar (subscription.overview.consultation)
                                const meta = cap.status === "expired" && !expiredCanConsult(data.consultation) ? expiredNoRead(t) : (CAP_STATUS[cap.status] ?? CAP_STATUS.contracted);
                                const Icon = meta.icon;
                                return (
                                  <li key={cap.id} className="flex flex-wrap items-start gap-2 text-sm">
                                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.tone)} aria-hidden="true" />
                                    <span className="min-w-[8rem] flex-1 break-words text-foreground">{cap.name}</span>
                                    {cap.status !== "active" && (
                                      <Badge variant="outline" className="text-xs">
                                        {meta.label}
                                      </Badge>
                                    )}
                                    {cap.status === "active" && <span className="sr-only">{t("subscription.page.cap.active")}</span>}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ))}
                      </div>
                      </>
                    )}
                  </TabsContent>

                  <TabsContent value="limits" className="space-y-4">
                    {data.limits.length > 0 && (
                      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
                        <h3 className="mb-1 font-semibold text-foreground">{t("subscription.page.limitsTitle")}</h3>
                        <p className="mb-4 text-sm text-muted-foreground">
                          {t("subscription.page.limitsIntro", { plan: data.plan?.name ?? t("subscription.common.yourPlan") })}
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <caption className="sr-only">{t("subscription.page.limitsCaption")}</caption>
                            <thead>
                              <tr className="border-b border-border text-left text-muted-foreground">
                                <th scope="col" className="py-2 pr-4 font-medium">
                                  {t("subscription.page.limitsResource")}
                                </th>
                                <th scope="col" className="py-2 pr-4 font-medium">
                                  {t("subscription.page.limitsIncluded")}
                                </th>
                                <th scope="col" className="py-2 font-medium">
                                  {t("subscription.page.limitsUsed")}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.limits.map((l) => {
                                const over = l.included !== null && l.used !== null && l.used > l.included;
                                return (
                                  <tr key={l.metric} className="border-b border-border last:border-0">
                                    <th scope="row" className="py-2.5 pr-4 text-left font-medium text-foreground">
                                      {l.label}
                                    </th>
                                    <td className="py-2.5 pr-4 text-foreground">{l.included === null ? t("subscription.page.limitsByContract") : l.included}</td>
                                    <td className={cn("py-2.5", over ? "font-medium text-warning" : "text-foreground")}>
                                      {l.used === null ? <span className="text-muted-foreground">{t("subscription.page.limitsUnavailable")}</span> : l.used}
                                      {over && t("subscription.page.limitsOver")}
                                      {l.included !== null && l.included > 0 && l.used !== null && (
                                        <div aria-hidden="true" className="mt-1.5 h-1.5 w-full min-w-24 max-w-48 overflow-hidden rounded-full bg-muted">
                                          <div className={cn("h-full rounded-full", over ? "bg-warning" : l.used / l.included >= 0.8 ? "bg-warning/70" : "bg-primary")} style={{ width: `${Math.min(100, Math.round((l.used / l.included) * 100))}%` }} />
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    <div className="space-y-4">
                      <h3 className="font-semibold text-foreground">{t("subscription.page.usageTitle")}</h3>
                      <UsageSection />
                      <Button asChild variant="outline">
                        <Link href="/admin/suscripcion/consumo">{t("subscription.page.usageBtn")}</Link>
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="modules" className="space-y-3 rounded-xl border border-border bg-card p-5 sm:p-6">
                    <h3 className="font-semibold text-foreground">{t("subscription.page.modulesTitle")}</h3>
                    <OwnedModules />
                  </TabsContent>

                  <TabsContent value="billing" className="space-y-4">
                    <PlanContractSection isTrial={trial} />
                    <BillingPortalSection />
                    <PlanChangeSection />
                    <CancellationSection />
                    {/* Desistimiento (particulares, dentro del plazo): distinto de cancelar la suscripción */}
                    <WithdrawalSection />
                    {!contract.data && !portal.enabled && !pc?.enabled && (
                      <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                        {isAdmin
                          ? trial
                            ? t("subscription.page.billingTrial")
                            : t("subscription.page.billingManaged")
                          : t("subscription.page.billingNotAdmin")}
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="data" className="space-y-3 rounded-xl border border-border bg-card p-5 sm:p-6">
                    {/* Exportación: también en solo lectura y suspendida */}
                    <h3 className="font-semibold text-foreground">{t("subscription.page.dataTitle")}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t("subscription.page.dataText")}
                    </p>
                    <Button asChild variant="outline">
                      <Link href="/admin/suscripcion/exportar">{t("subscription.page.dataBtn")}</Link>
                    </Button>
                  </TabsContent>
                </Tabs>
              </section>

              {data.upgradeUrl && (
                <p className="text-sm text-muted-foreground">
                  <a href={data.upgradeUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
                    {t("subscription.page.allPlansOnWeb")}
                    <span className="sr-only">{t("subscription.page.newTab")}</span>
                  </a>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
