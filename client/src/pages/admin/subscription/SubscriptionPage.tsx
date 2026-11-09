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
  const portal = useBillingPortal();
  if (!portal.enabled) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5 sm:p-6" aria-labelledby="sub-invoices">
      <h3 id="sub-invoices" className="font-semibold text-foreground">
        Facturas de la suscripción
      </h3>
      <p className="text-sm text-muted-foreground">Consulta y descarga tus facturas y actualiza el método de pago en el portal seguro de nuestro proveedor de cobros. Desde allí no se cambia ni se cancela el plan.</p>
      <Button type="button" variant="outline" disabled={portal.open.isPending} onClick={() => portal.open.mutate()}>
        {portal.open.isPending ? "Abriendo…" : "Ver facturas y método de pago"}
        <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
      </Button>
    </section>
  );
}

const GROUP_LABELS: Record<string, string> = {
  crm: "Clientes y ventas",
  ecommerce: "Catálogo y comercio",
  cms: "Web",
  billing: "Facturación",
  admin: "Organización",
  comms: "Comunicaciones",
  automation: "Automatizaciones",
  business: "Negocio",
  enterprise: "Empresa",
  finance: "Finanzas",
  ai: "Inteligencia artificial",
  marketing: "Marketing",
  operations: "Operaciones",
  net: "Módulos sectoriales",
};

const CAP_STATUS: Record<string, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  active: { label: "Activa", icon: CheckCircle2, tone: "text-success" },
  read_only: { label: "Solo lectura", icon: Eye, tone: "text-warning" },
  expired: { label: "Caducada (solo lectura)", icon: Eye, tone: "text-warning" },
  contracted: { label: "Contratada, pendiente de activar", icon: Clock, tone: "text-muted-foreground" },
  pending_setup: { label: "Pendiente de configuración", icon: Clock, tone: "text-muted-foreground" },
  suspended: { label: "Suspendida", icon: ShieldAlert, tone: "text-danger" },
  cancelled: { label: "Cancelada", icon: ShieldAlert, tone: "text-muted-foreground" },
};

/** Capacidad caducada sin consulta (p. ej. el plazo de solo lectura vencido: decide() tampoco deja leer). */
const EXPIRED_NO_READ = { label: "Caducada", icon: Clock, tone: "text-muted-foreground" };

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }));

const TABS = ["features", "limits", "modules", "billing", "data"] as const;
type DetailTab = (typeof TABS)[number];

export default function SubscriptionPage() {
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
  const cards = useMemo(
    () => (data ? buildPlanComparison({ plans, currentPlanKey: data.plan?.key ?? null, state: data.state, isAdmin, conversion: conversion.data ?? null, planChange: pc }) : []),
    [plans, data, isAdmin, conversion.data, pc],
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

          {sub.isLoading && <PanelLoading label="Cargando tu suscripción…" />}
          {sub.isError && <PanelError error={sub.error} onRetry={() => sub.refetch()} title="No se ha podido cargar tu suscripción" />}

          {data && data.licensing === "legacy" && (
            <section className="flex gap-3 rounded-2xl border border-border bg-card p-6" aria-labelledby="sub-legacy">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div>
                <h2 id="sub-legacy" className="font-semibold text-foreground">
                  Instalación con licencia propia
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Esta plataforma funciona con una instalación dedicada y no depende de un plan de suscripción por funcionalidades. Para cambios en lo contratado, contacta con tu responsable de cuenta.
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
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Planes de Elephant Core
                    </p>
                    <h2 id="sub-plans" className="text-balance text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                      {trial ? "Elige el plan con el que quieres seguir" : "Compara los planes"}
                    </h2>
                    <p className="text-pretty text-sm text-muted-foreground sm:text-base">
                      {trial ? "Compara y contrata el plan para tu negocio. Todo lo que has preparado durante la prueba se conserva." : "Compara tu plan con el resto. Tus datos, usuarios y configuración se conservan con cualquier plan."}
                    </p>
                  </div>
                  <PlanAssurances trial={trial} />
                </div>
                {catalog.isLoading && <PanelLoading label="Cargando los planes…" />}
                {catalog.isError && <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title="No se han podido cargar los planes" />}
                {catalog.isSuccess && cards.length === 0 && (
                  <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
                    La comparativa de planes no está disponible ahora mismo.{" "}
                    {data.upgradeUrl ? (
                      <a href={data.upgradeUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
                        Consulta los planes en nuestra web
                      </a>
                    ) : (
                      "Escribe a tu contacto comercial y te ayudamos a elegir."
                    )}
                  </p>
                )}
                {cards.length > 0 && (
                  <>
                    <PlanComparison cards={cards} currentKey={data.plan?.key ?? null} requests={planRequests.data} current={pc?.current ?? null} onConvert={onConvert} />
                    <PlanRequestList requests={planRequests.data ?? []} />
                    <p className="text-xs text-muted-foreground">Precios publicados en el catálogo oficial de Elephant Source. El importe de cada alta o cambio se calcula en el servidor y se muestra antes de confirmar.</p>
                  </>
                )}
              </section>

              {/* Contratar desde la prueba (solo administración; el servidor decide si está disponible) */}
              {trial && <ConversionSection requested={requested} currentPlan={data.plan?.key ?? null} plans={plans} />}

              <GrowSection />

              {/* Detalle organizado en pestañas */}
              <section id="detalle" aria-labelledby="sub-detail" className="scroll-mt-4 space-y-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span aria-hidden="true" data-tone="night" className="cx-tone-chip inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-black/20 sm:h-12 sm:w-12">
                    <Layers className="h-6 w-6" />
                  </span>
                  <div className="min-w-0">
                    <h2 id="sub-detail" className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                      Detalle de tu suscripción
                    </h2>
                    <p className="text-sm text-muted-foreground">Funcionalidades, límites y consumo, módulos, facturación y tus datos.</p>
                  </div>
                </div>
                <span id="facturacion" className="block scroll-mt-4" aria-hidden="true" />
                <Tabs value={tab} onValueChange={(v) => setTab(v as DetailTab)} className="gap-4">
                  <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-2xl p-1">
                    <TabsTrigger value="features" className="flex-none rounded-xl px-3 py-1.5">
                      Funcionalidades
                    </TabsTrigger>
                    <TabsTrigger value="limits" className="flex-none rounded-xl px-3 py-1.5">
                      Límites y consumo
                    </TabsTrigger>
                    <TabsTrigger value="modules" className="flex-none rounded-xl px-3 py-1.5">
                      Módulos contratados
                    </TabsTrigger>
                    <TabsTrigger value="billing" className="flex-none rounded-xl px-3 py-1.5">
                      Facturación y contrato
                    </TabsTrigger>
                    <TabsTrigger value="data" className="flex-none rounded-xl px-3 py-1.5">
                      Tus datos
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="features" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <h3 className="mb-1 font-semibold text-foreground">Funcionalidades incluidas</h3>
                    <p className="mb-4 text-sm text-muted-foreground">Lo que tu empresa tiene contratado o en prueba, y su estado.</p>
                    {data.capabilities.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Todavía no hay funcionalidades asignadas a tu empresa.</p>
                    ) : (
                      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                        {Object.entries(
                          data.capabilities.reduce<Record<string, typeof data.capabilities>>((acc, cap) => {
                            (acc[cap.group] ??= []).push(cap);
                            return acc;
                          }, {}),
                        ).map(([group, caps]) => (
                          <div key={group} className="min-w-0 rounded-xl border border-border bg-background/40 p-4">
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{GROUP_LABELS[group] ?? group}</h4>
                            <ul className="space-y-1.5">
                              {caps.map((cap) => {
                                // «Caducada (solo lectura)» solo si hoy se puede consultar (subscription.overview.consultation)
                                const meta = cap.status === "expired" && !expiredCanConsult(data.consultation) ? EXPIRED_NO_READ : (CAP_STATUS[cap.status] ?? CAP_STATUS.contracted);
                                const Icon = meta.icon;
                                return (
                                  <li key={cap.id} className="flex flex-wrap items-start gap-2 text-sm">
                                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.tone)} aria-hidden="true" />
                                    <span className="min-w-0 flex-1 break-words text-foreground">{cap.name}</span>
                                    {cap.status !== "active" && (
                                      <Badge variant="outline" className="text-[11px]">
                                        {meta.label}
                                      </Badge>
                                    )}
                                    {cap.status === "active" && <span className="sr-only">Activa</span>}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="limits" className="space-y-4">
                    {data.limits.length > 0 && (
                      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                        <h3 className="mb-1 font-semibold text-foreground">Límites del plan</h3>
                        <p className="mb-4 text-sm text-muted-foreground">
                          Incluidos en {data.plan?.name ?? "tu plan"}. Las ampliaciones contratadas (por ejemplo, usuarios adicionales) se suman a estos valores.
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <caption className="sr-only">Límites incluidos en el plan y uso actual</caption>
                            <thead>
                              <tr className="border-b border-border text-left text-muted-foreground">
                                <th scope="col" className="py-2 pr-4 font-medium">
                                  Recurso
                                </th>
                                <th scope="col" className="py-2 pr-4 font-medium">
                                  Incluido
                                </th>
                                <th scope="col" className="py-2 font-medium">
                                  En uso
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
                                    <td className="py-2.5 pr-4 text-foreground">{l.included === null ? "Según contrato" : l.included}</td>
                                    <td className={cn("py-2.5", over ? "font-medium text-warning" : "text-foreground")}>
                                      {l.used === null ? <span className="text-muted-foreground">No disponible aquí</span> : l.used}
                                      {over && " · por encima de lo incluido"}
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
                      <h3 className="font-semibold text-foreground">Consumo actual</h3>
                      <UsageSection />
                      <Button asChild variant="outline">
                        <Link href="/admin/suscripcion/consumo">Ver consumo</Link>
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="modules" className="space-y-3 rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <h3 className="font-semibold text-foreground">Módulos adicionales contratados</h3>
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
                      <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
                        {isAdmin
                          ? trial
                            ? "Estás en la prueba gratuita: no hay ningún cobro ni contrato todavía."
                            : "Tu plan lo gestiona directamente el equipo de Elephant Source. Para cambios, escribe a tu contacto comercial."
                          : "El contrato y las facturas de la suscripción solo los ve la administración de tu empresa."}
                      </p>
                    )}
                  </TabsContent>

                  <TabsContent value="data" className="space-y-3 rounded-2xl border border-border bg-card p-5 sm:p-6">
                    {/* Exportación: también en solo lectura y suspendida */}
                    <h3 className="font-semibold text-foreground">Tus datos</h3>
                    <p className="text-sm text-muted-foreground">
                      Descarga una copia de los datos y ficheros de tu empresa (ZIP con CSV y JSON). Disponible durante la prueba, con la suscripción activa y también en solo lectura.
                    </p>
                    <Button asChild variant="outline">
                      <Link href="/admin/suscripcion/exportar">Exportar mis datos</Link>
                    </Button>
                  </TabsContent>
                </Tabs>
              </section>

              {data.upgradeUrl && (
                <p className="text-sm text-muted-foreground">
                  <a href={data.upgradeUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
                    Ver todos los planes en nuestra web
                    <span className="sr-only"> (se abre en otra pestaña)</span>
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
