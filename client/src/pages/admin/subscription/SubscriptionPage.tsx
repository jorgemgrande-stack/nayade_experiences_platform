/**
 * Suscripción de la empresa: plan y estado (prueba, renovación, facturas), comparador de planes de Elephant Core,
 * contratación o cambio de plan cuando el servidor lo permite, funcionalidades, límites y consumo, módulos
 * adicionales, facturación, datos y desistimiento. Todo se lee del servidor (subscription.*, connect.catalog); aquí
 * no se calcula ningún precio ni se decide quién puede contratar.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowUpRight, CalendarClock, CheckCircle2, Clock, CreditCard, Eye, Hourglass, Info, Rocket, ShieldAlert } from "lucide-react";
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
import { ConversionSection } from "./ConversionSection";
import { CancellationSection, PlanChangeSection } from "./SelfServiceSection";
import { PlanComparison } from "./PlanComparison";
import { GrowSection, OwnedModules } from "./GrowSection";
import { UsageSection } from "./UsagePage";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { buildPlanComparison, isTrialState, parsePanelPlans, type PlanChangeInfo, type SelfServicePlanKey } from "@shared/subscriptionPlans";
import "@/components/connect/connectStage.css";

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
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-3" aria-labelledby="sub-invoices">
      <h3 id="sub-invoices" className="font-semibold text-foreground">Facturas de la suscripción</h3>
      <p className="text-sm text-muted-foreground">Consulta y descarga tus facturas y actualiza el método de pago en el portal seguro de nuestro proveedor de cobros. Desde allí no se cambia ni se cancela el plan.</p>
      <Button type="button" variant="outline" disabled={portal.open.isPending} onClick={() => portal.open.mutate()}>
        {portal.open.isPending ? "Abriendo…" : "Ver facturas y método de pago"}
        <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
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

const STATE_META: Record<string, { label: string; tone: string }> = {
  trial: { label: "Prueba gratuita", tone: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200" },
  trial_expired: { label: "Prueba finalizada", tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
  active: { label: "Activa", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" },
  read_only: { label: "Solo lectura", tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
  suspended: { label: "Suspendida", tone: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-200" },
  cancelled: { label: "Cancelada", tone: "bg-muted text-foreground" },
  pending: { label: "Pendiente de activar", tone: "bg-muted text-foreground" },
  none: { label: "Sin plan activo", tone: "bg-muted text-foreground" },
};

const CAP_STATUS: Record<string, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  active: { label: "Activa", icon: CheckCircle2, tone: "text-emerald-700 dark:text-emerald-400" },
  read_only: { label: "Solo lectura", icon: Eye, tone: "text-amber-700 dark:text-amber-400" },
  expired: { label: "Caducada (solo lectura)", icon: Eye, tone: "text-amber-700 dark:text-amber-400" },
  contracted: { label: "Contratada, pendiente de activar", icon: Clock, tone: "text-muted-foreground" },
  pending_setup: { label: "Pendiente de configuración", icon: Clock, tone: "text-muted-foreground" },
  suspended: { label: "Suspendida", icon: ShieldAlert, tone: "text-red-700 dark:text-red-400" },
  cancelled: { label: "Cancelada", icon: ShieldAlert, tone: "text-muted-foreground" },
};

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

function UpgradeAction({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return (
      <p className="text-sm text-muted-foreground">
        Para ampliar o contratar, escribe a tu contacto comercial de Elephant Source: te ayudará a elegir el plan o los módulos que necesitas.
      </p>
    );
  }
  return (
    <Button asChild variant="outline">
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
        <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
        <span className="sr-only"> (se abre en otra pestaña)</span>
      </a>
    </Button>
  );
}

/** Dato destacado de la cabecera (prueba, importe, renovación). */
function Fact({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/40 p-3">
      <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 break-words font-semibold text-foreground">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

const scrollTo = (id: string) =>
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));

const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);

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
  const support = trpc.subscription.supportContact.useQuery(undefined, { retry: false, staleTime: 300_000, enabled: licensed });
  const portal = useBillingPortal();
  const [requested, setRequested] = useState<{ plan: SelfServicePlanKey; at: number } | null>(null);

  const plans = useMemo(() => parsePanelPlans((catalog.data as { plans?: unknown } | null | undefined)?.plans), [catalog.data]);
  const pc = (planChange.data ?? null) as PlanChangeInfo | null;
  const cards = useMemo(
    () => (data ? buildPlanComparison({ plans, currentPlanKey: data.plan?.key ?? null, state: data.state, isAdmin, conversion: conversion.data ?? null, planChange: pc }) : []),
    [plans, data, isAdmin, conversion.data, pc],
  );

  const period = contract.data?.period ?? null;
  const c = contract.data?.contract ?? null;
  const renewal = period?.cancelAt ? { label: "Fin del servicio", at: period.cancelAt } : period?.renewsAt ? { label: "Próxima renovación", at: period.renewsAt } : null;
  const conversionOn = !!conversion.data?.enabled;
  const onConvert = (plan: SelfServicePlanKey) => {
    setRequested({ plan, at: Date.now() });
    scrollTo("contratar");
  };

  return (
    <AdminLayout>
      <div className="cx-stage -m-4 min-h-full p-4 sm:-m-6 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Suscripción</h1>
            <p className="text-sm text-muted-foreground">Tu plan, lo que incluye, sus límites y cómo ampliarlo.</p>
          </div>

          {sub.isLoading && <PanelLoading label="Cargando tu suscripción…" />}
          {sub.isError && <PanelError error={sub.error} onRetry={() => sub.refetch()} title="No se ha podido cargar tu suscripción" />}

          {data && data.licensing === "legacy" && (
            <section className="rounded-2xl border border-border bg-card p-6 flex gap-3" aria-labelledby="sub-legacy">
              <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h2 id="sub-legacy" className="font-semibold text-foreground">Instalación con licencia propia</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Esta plataforma funciona con una instalación dedicada y no depende de un plan de suscripción por funcionalidades.
                  Para cambios en lo contratado, contacta con tu responsable de cuenta.
                </p>
              </div>
            </section>
          )}

          {data && licensed && (
            <>
              {/* Cabecera: plan, estado, prueba, importe, renovación y facturas */}
              <section className="cx-glow rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5" aria-labelledby="sub-plan">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true">
                      <Rocket className="h-6 w-6" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">{trial ? "Plan en prueba" : "Tu plan"}</p>
                      <h2 id="sub-plan" className="break-words text-2xl font-bold text-foreground">
                        {data.plan?.name ?? "Sin plan asignado"}
                      </h2>
                    </div>
                  </div>
                  <span className={cn("inline-flex w-fit rounded-full px-3 py-1 text-sm font-medium", STATE_META[data.state]?.tone)}>{STATE_META[data.state]?.label ?? data.state}</span>
                </div>

                {(data.trial || renewal || c) && (
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {data.trial && (
                      <Fact
                        icon={<Hourglass className="h-3.5 w-3.5" />}
                        label="Prueba gratuita"
                        value={data.trial.daysLeft > 0 ? `Te ${data.trial.daysLeft === 1 ? "queda 1 día" : `quedan ${data.trial.daysLeft} días`}` : "Finalizada"}
                        hint={data.trial.daysLeft > 0 ? `Hasta el ${fmtDate(data.trial.endsAt)}` : `Terminó el ${fmtDate(data.trial.endsAt)}`}
                      />
                    )}
                    {c && (
                      <Fact
                        icon={<CreditCard className="h-3.5 w-3.5" />}
                        label={`Suscripción ${c.interval === "year" ? "anual" : "mensual"}`}
                        value={c.recurringNetCents === null ? "Según contrato" : `${money(c.recurringNetCents, c.currency)} + IVA`}
                      />
                    )}
                    {renewal && <Fact icon={<CalendarClock className="h-3.5 w-3.5" />} label={renewal.label} value={fmtDate(renewal.at)} />}
                  </dl>
                )}

                {data.trial && (
                  <p className="text-sm text-muted-foreground">
                    {data.trial.daysLeft > 0 ? (
                      "Estás en la prueba gratuita: no es una suscripción de pago y no se te ha cobrado nada. Al terminar, tus datos se conservan y podrás consultarlos; para seguir creando y editando tendrás que contratar el plan."
                    ) : (
                      <>
                        Tus datos se conservan en <strong className="text-foreground">solo lectura</strong>: contrata el plan para seguir trabajando.
                      </>
                    )}
                  </p>
                )}
                {data.state === "read_only" && !data.trial && (
                  <p className="text-sm text-amber-800 dark:text-amber-300">Tu cuenta está en solo lectura: puedes consultar tus datos, pero no crear ni modificar.</p>
                )}
                {data.state === "suspended" && (
                  <p className="text-sm text-red-800 dark:text-red-300">Tu suscripción está suspendida. Contacta con tu responsable de cuenta para reactivarla.</p>
                )}

                <div className="flex flex-wrap gap-2">
                  {cards.length > 0 && (
                    <Button type="button" onClick={() => scrollTo("planes")}>
                      {trial && conversionOn ? "Ver planes y contratar" : "Comparar planes"}
                    </Button>
                  )}
                  {portal.enabled && (
                    <Button type="button" variant="outline" disabled={portal.open.isPending} onClick={() => portal.open.mutate()}>
                      {portal.open.isPending ? "Abriendo…" : "Facturas y método de pago"}
                      <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                  {(data.trial || data.state !== "active") && !conversionOn && (
                    <UpgradeAction url={data.upgradeUrl} label={data.trial ? "Contratar el plan" : "Ver opciones de contratación"} />
                  )}
                </div>
              </section>

              {/* Comparador de planes publicados */}
              <section id="planes" className="scroll-mt-4 space-y-4" aria-labelledby="sub-plans">
                <div className="space-y-1">
                  <h2 id="sub-plans" className="text-xl font-bold text-foreground">Planes de Elephant Core</h2>
                  <p className="text-sm text-muted-foreground">
                    {trial
                      ? "Compara los planes y elige con cuál seguir. Todo lo que has preparado durante la prueba se conserva."
                      : "Compara tu plan con el resto. Tus datos, usuarios y configuración se conservan con cualquier plan."}
                  </p>
                </div>
                {catalog.isLoading && <PanelLoading label="Cargando los planes…" />}
                {!catalog.isLoading && cards.length === 0 && (
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
                    <PlanComparison cards={cards} contact={{ upgradeUrl: data.upgradeUrl, supportEmail: support.data?.email ?? null }} current={pc?.current ?? null} onConvert={onConvert} />
                    <p className="text-xs text-muted-foreground">Precios publicados en el catálogo oficial de Elephant Source. El importe exacto de cada alta o cambio se calcula y se muestra antes de confirmar.</p>
                  </>
                )}
              </section>

              {/* Contratar desde la prueba (solo administración; el servidor decide si está disponible) */}
              {trial && <ConversionSection requested={requested} />}

              {/* Detalle organizado en pestañas */}
              <section aria-labelledby="sub-detail" className="space-y-3">
                <h2 id="sub-detail" className="text-xl font-bold text-foreground">Detalle de tu suscripción</h2>
                <Tabs defaultValue="features" className="gap-4">
                  <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 p-1">
                    <TabsTrigger value="features" className="flex-none px-3 py-1.5">Funcionalidades</TabsTrigger>
                    <TabsTrigger value="limits" className="flex-none px-3 py-1.5">Límites y consumo</TabsTrigger>
                    <TabsTrigger value="modules" className="flex-none px-3 py-1.5">Módulos adicionales</TabsTrigger>
                    <TabsTrigger value="billing" className="flex-none px-3 py-1.5">Facturación y contrato</TabsTrigger>
                    <TabsTrigger value="data" className="flex-none px-3 py-1.5">Tus datos</TabsTrigger>
                  </TabsList>

                  <TabsContent value="features" className="rounded-2xl border border-border bg-card p-5 sm:p-6">
                    <h3 className="font-semibold text-foreground mb-1">Funcionalidades incluidas</h3>
                    <p className="text-sm text-muted-foreground mb-4">Lo que tu empresa tiene contratado o en prueba, y su estado.</p>
                    {data.capabilities.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Todavía no hay funcionalidades asignadas a tu empresa.</p>
                    ) : (
                      <div className="grid gap-5 md:grid-cols-2">
                        {Object.entries(
                          data.capabilities.reduce<Record<string, typeof data.capabilities>>((acc, cap) => {
                            (acc[cap.group] ??= []).push(cap);
                            return acc;
                          }, {}),
                        ).map(([group, caps]) => (
                          <div key={group} className="min-w-0">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{GROUP_LABELS[group] ?? group}</h4>
                            <ul className="space-y-1.5">
                              {caps.map((cap) => {
                                const meta = CAP_STATUS[cap.status] ?? CAP_STATUS.contracted;
                                const Icon = meta.icon;
                                return (
                                  <li key={cap.id} className="flex flex-wrap items-start gap-2 text-sm">
                                    <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", meta.tone)} aria-hidden="true" />
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
                        <h3 className="font-semibold text-foreground mb-1">Límites del plan</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Incluidos en {data.plan?.name ?? "tu plan"}. Las ampliaciones contratadas (por ejemplo, usuarios adicionales) se suman a estos valores.
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <caption className="sr-only">Límites incluidos en el plan y uso actual</caption>
                            <thead>
                              <tr className="text-left text-muted-foreground border-b border-border">
                                <th scope="col" className="py-2 pr-4 font-medium">Recurso</th>
                                <th scope="col" className="py-2 pr-4 font-medium">Incluido</th>
                                <th scope="col" className="py-2 font-medium">En uso</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.limits.map((l) => {
                                const over = l.included !== null && l.used !== null && l.used > l.included;
                                return (
                                  <tr key={l.metric} className="border-b border-border last:border-0">
                                    <th scope="row" className="py-2.5 pr-4 font-medium text-foreground text-left">{l.label}</th>
                                    <td className="py-2.5 pr-4 text-foreground">{l.included === null ? "Según contrato" : l.included}</td>
                                    <td className={cn("py-2.5", over ? "text-amber-800 dark:text-amber-300 font-medium" : "text-foreground")}>
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

                  <TabsContent value="modules" className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-3">
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

                  <TabsContent value="data" className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-3">
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

              <GrowSection />

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
