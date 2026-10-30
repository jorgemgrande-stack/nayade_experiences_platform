/**
 * Suscripción de la empresa: plan, prueba (días restantes), capacidades incluidas, límites y
 * cómo ampliar. Todo se lee del servidor (subscription.overview); aquí no se calcula ningún precio.
 */
import { Link } from "wouter";
import { ArrowUpRight, CheckCircle2, Clock, Eye, Info, Rocket, ShieldAlert } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { cn } from "@/lib/utils";
import { WithdrawalSection } from "./WithdrawalSection";
import { PlanContractSection } from "./PlanContractSection";
import { ConversionSection } from "./ConversionSection";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/** Facturas de la suscripción en el portal de Stripe: solo la persona propietaria y si está activado. */
function BillingPortalSection() {
  const status = trpc.subscription.billingPortalStatus.useQuery(undefined, { retry: false, staleTime: 300_000 });
  const open = trpc.subscription.billingPortal.useMutation({
    onSuccess: (r) => window.location.assign((r as { url: string }).url),
    onError: (e) => toast.error(e.message),
  });
  if (!status.data?.enabled) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-3" aria-labelledby="sub-invoices">
      <h2 id="sub-invoices" className="font-semibold text-foreground">Facturas de la suscripción</h2>
      <p className="text-sm text-muted-foreground">Consulta y descarga tus facturas y actualiza el método de pago en el portal seguro de nuestro proveedor de cobros. Desde allí no se cambia ni se cancela el plan.</p>
      <Button type="button" variant="outline" disabled={open.isPending} onClick={() => open.mutate()}>
        {open.isPending ? "Abriendo…" : "Ver facturas y método de pago"}
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
    <Button asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label}
        <ArrowUpRight className="w-4 h-4 ml-1.5" aria-hidden="true" />
        <span className="sr-only"> (se abre en otra pestaña)</span>
      </a>
    </Button>
  );
}

export default function SubscriptionPage() {
  const sub = usePanelSubscription();
  const data = sub.data;

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Suscripción</h1>
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

        {data && data.licensing === "capabilities" && (
          <>
            {/* Plan y estado */}
            <section className="rounded-2xl border border-border bg-card p-6 space-y-4" aria-labelledby="sub-plan">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0" aria-hidden="true">
                    <Rocket className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Plan</p>
                    <h2 id="sub-plan" className="text-xl font-semibold text-foreground">{data.plan?.name ?? "Sin plan asignado"}</h2>
                  </div>
                </div>
                <span className={cn("inline-flex w-fit rounded-full px-3 py-1 text-sm font-medium", STATE_META[data.state]?.tone)}>
                  {STATE_META[data.state]?.label ?? data.state}
                </span>
              </div>

              {data.trial && (
                <div className="rounded-xl bg-muted/50 p-4 space-y-2">
                  {data.trial.daysLeft > 0 ? (
                    <>
                      <p className="text-sm text-foreground">
                        Te quedan <strong>{data.trial.daysLeft} {data.trial.daysLeft === 1 ? "día" : "días"}</strong> de prueba
                        (hasta el {fmtDate(data.trial.endsAt)}).
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Al terminar, tus datos se conservan y podrás consultarlos; para seguir creando y editando tendrás que contratar el plan.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-foreground">
                      Tu prueba terminó el {fmtDate(data.trial.endsAt)}. Tus datos se conservan en <strong>solo lectura</strong>: contrata el plan para seguir trabajando.
                    </p>
                  )}
                </div>
              )}

              {data.state === "read_only" && !data.trial && (
                <p className="text-sm text-amber-800 dark:text-amber-300">Tu cuenta está en solo lectura: puedes consultar tus datos, pero no crear ni modificar.</p>
              )}
              {data.state === "suspended" && (
                <p className="text-sm text-red-800 dark:text-red-300">Tu suscripción está suspendida. Contacta con tu responsable de cuenta para reactivarla.</p>
              )}

              {(data.trial || data.state !== "active") && (
                <UpgradeAction url={data.upgradeUrl} label={data.trial ? "Contratar el plan" : "Ver opciones de contratación"} />
              )}
            </section>

            {/* Contratar desde la prueba (solo administración; el servidor decide si está disponible) */}
            {(data.trial || data.state === "trial_expired") && <ConversionSection />}

            {/* Límites */}
            {data.limits.length > 0 && (
              <section className="rounded-2xl border border-border bg-card p-6" aria-labelledby="sub-limits">
                <h2 id="sub-limits" className="font-semibold text-foreground mb-1">Límites del plan</h2>
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
              </section>
            )}

            {/* Funcionalidades */}
            <section className="rounded-2xl border border-border bg-card p-6" aria-labelledby="sub-caps">
              <h2 id="sub-caps" className="font-semibold text-foreground mb-1">Funcionalidades incluidas</h2>
              <p className="text-sm text-muted-foreground mb-4">Lo que tu empresa tiene contratado o en prueba, y su estado.</p>
              {data.capabilities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay funcionalidades asignadas a tu empresa.</p>
              ) : (
                <div className="grid gap-5 md:grid-cols-2">
                  {Object.entries(
                    data.capabilities.reduce<Record<string, typeof data.capabilities>>((acc, c) => {
                      (acc[c.group] ??= []).push(c);
                      return acc;
                    }, {}),
                  ).map(([group, caps]) => (
                    <div key={group}>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{GROUP_LABELS[group] ?? group}</h3>
                      <ul className="space-y-1.5">
                        {caps.map((c) => {
                          const meta = CAP_STATUS[c.status] ?? CAP_STATUS.contracted;
                          const Icon = meta.icon;
                          return (
                            <li key={c.id} className="flex items-start gap-2 text-sm">
                              <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", meta.tone)} aria-hidden="true" />
                              <span className="flex-1 text-foreground">{c.name}</span>
                              {c.status !== "active" && (
                                <Badge variant="outline" className="text-[11px]">{meta.label}</Badge>
                              )}
                              {c.status === "active" && <span className="sr-only">Activa</span>}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Ampliar */}
            <section id="ampliar" className="rounded-2xl border border-dashed border-border bg-card p-6 space-y-3" aria-labelledby="sub-more">
              <h2 id="sub-more" className="font-semibold text-foreground">Ampliar</h2>
              <p className="text-sm text-muted-foreground">
                ¿Necesitas más usuarios, más sedes o un módulo que no tienes? Consulta los planes y módulos disponibles.
                Lo que no está contratado no aparece en tu menú.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/admin/suscripcion/modulos">Ver módulos y ampliaciones</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/admin/suscripcion/consumo">Ver consumo</Link>
                </Button>
                {/* Sin enlace de contratación la indicación ya aparece arriba: no se repite */}
                {data.upgradeUrl && <UpgradeAction url={data.upgradeUrl} label="Ver planes" />}
              </div>
              <p className="text-xs text-muted-foreground">
                Los usuarios de tu equipo se gestionan en <Link href="/admin/usuarios" className="underline underline-offset-4 hover:text-foreground">Usuarios y permisos</Link>.
              </p>
            </section>

            <PlanContractSection isTrial={!!data.trial || data.state === "trial_expired"} />

            <BillingPortalSection />

            {/* Tus datos: exportación (también en solo lectura y suspendida) */}
            <section className="rounded-2xl border border-border bg-card p-6 space-y-3" aria-labelledby="sub-data">
              <h2 id="sub-data" className="font-semibold text-foreground">Tus datos</h2>
              <p className="text-sm text-muted-foreground">
                Descarga una copia de los datos y ficheros de tu empresa (ZIP con CSV y JSON). Disponible durante la prueba, con la suscripción activa y también en solo lectura.
              </p>
              <Button asChild variant="outline">
                <Link href="/admin/suscripcion/exportar">Exportar mis datos</Link>
              </Button>
            </section>

            {/* Desistimiento (particulares, dentro del plazo): distinto de cancelar la suscripción */}
            <WithdrawalSection />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
