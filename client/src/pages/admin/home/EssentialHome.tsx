/**
 * Inicio del panel para empresas con licencias por capacidad (Elephant Source).
 * Qué pasa, qué tengo pendiente, primeros pasos y accesos rápidos, con datos reales del servidor:
 * no hay métricas inventadas; si una cifra no se puede leer se dice y se ofrece reintentar.
 * Cada consulta se hace solo si el plan incluye la capacidad y el rol tiene acceso.
 */
import { Link, Redirect } from "wouter";
import {
  ArrowRight, Building2, CheckCircle2, Circle, FilePlus2, Inbox, PackagePlus, Rocket, UserPlus, Users,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { PanelError } from "@/components/admin/PanelStates";
import { SETUP_WIZARD_PATH, SetupWizardLink } from "@/components/SetupWizardLink";
import { shouldOpenSetupWizard } from "@shared/setupWizard";
import { missingFiscalFields } from "@shared/formValidation";
import { cn } from "@/lib/utils";

const FEED_LABELS: Record<string, string> = {
  lead: "Oportunidades sin atender",
  quote: "Presupuestos enviados sin respuesta",
  cancellation: "Solicitudes de anulación",
  pending_payment: "Cobros vencidos",
  tpv_alert: "Avisos de caja y TPV",
  upcoming_reservation: "Pedidos para mañana",
  task: "Tareas para hoy o vencidas",
};

function Section({ id, title, description, children, className }: { id: string; title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("rounded-2xl border border-border bg-card p-5", className)}>
      <h2 id={id} className="font-semibold text-foreground">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, href, loading }: { label: string; value: number | undefined; href: string; loading: boolean }) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border p-4 hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-2xl font-semibold text-foreground tabular-nums" aria-hidden={loading || undefined}>
        {loading ? <span className="inline-block h-7 w-10 rounded bg-muted animate-pulse align-middle" /> : (value ?? 0)}
      </p>
      <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
        {label}
        <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
      </p>
      {loading && <span className="sr-only">Cargando {label}</span>}
    </Link>
  );
}

/** Marca la primera visita al Inicio en esta sesión del navegador (sin almacenamiento disponible: solo la primera vez que se pide). */
let askedOnce = false;
function firstVisitThisSession(): boolean {
  try {
    if (sessionStorage.getItem("es_setup_wizard_opened")) return false;
    sessionStorage.setItem("es_setup_wizard_opened", "1");
    return true;
  } catch {
    if (askedOnce) return false;
    askedOnce = true;
    return true;
  }
}

export default function EssentialHome() {
  const { user } = useAuth();
  const role = (user as { role?: string } | null)?.role ?? "user";
  const isAdmin = role === "admin";
  const isSales = role === "admin" || role === "agente";
  const sub = usePanelSubscription();
  const data = sub.data;
  // Primera entrada de una empresa nueva: a «Primeros pasos» una vez por sesión (después, la tarjeta del Inicio)
  const wizard = trpc.setupWizard.status.useQuery(undefined, { enabled: isAdmin, retry: false, staleTime: 60_000 });
  const openWizard = isAdmin && shouldOpenSetupWizard(wizard.data?.progress) && firstVisitThisSession();

  const canCrm = isSales && sub.can("crm-leads");
  const canCatalog = isAdmin && sub.can("shop-catalog");
  const canSettings = isAdmin && sub.can("cms-editor");

  const leadCounters = trpc.crm.leads.counters.useQuery(undefined, { enabled: canCrm, retry: 1 });
  const quoteCounters = trpc.crm.quotes.counters.useQuery(undefined, { enabled: canCrm && sub.can("crm-quotes"), retry: 1 });
  const resCounters = trpc.crm.reservations.counters.useQuery(undefined, { enabled: canCrm && sub.can("shop-orders"), retry: 1 });
  const clients = trpc.crm.clients.list.useQuery({ limit: 1, offset: 0 }, { enabled: canCrm && sub.can("crm-contacts"), retry: 1 });
  const products = trpc.products.getAll.useQuery(undefined, { enabled: canCatalog, retry: 1 });
  const users = trpc.admin.getUsers.useQuery(undefined, { enabled: isAdmin, retry: 1 });
  const settings = trpc.cms.getSiteSettings.useQuery(undefined, { enabled: canSettings, retry: 1 });
  const feed = trpc.notifications.feed.useQuery(undefined, { enabled: isSales, refetchInterval: 60_000, refetchIntervalInBackground: false });
  const canTasks = isSales && sub.can("crm-tasks");
  const taskSummary = trpc.crmTasks.summary.useQuery(undefined, { enabled: canTasks, retry: 1 });

  const firstName = (user?.name ?? "").trim().split(/\s+/)[0];
  const pending = (feed.data?.sections ?? []).filter((s) => s.total > 0);
  // Mis tareas pendientes (además de las de hoy o vencidas que ya avisa el feed)
  const myTasks = canTasks ? taskSummary.data?.minePending ?? 0 : 0;

  // Primeros pasos: cada paso se marca con datos reales
  const fiscalMissing = settings.data ? missingFiscalFields(settings.data as Record<string, string>) : null;
  const quotesTotal = quoteCounters.data
    ? quoteCounters.data.borrador + quoteCounters.data.enviado + quoteCounters.data.ganado + quoteCounters.data.perdido + quoteCounters.data.pagoFallido
    : undefined;
  const steps = [
    canSettings && {
      key: "fiscal",
      label: "Completa los datos fiscales de tu empresa",
      hint: fiscalMissing && fiscalMissing.length ? `Falta: ${fiscalMissing.join(", ")}.` : "Aparecen como emisor en tus facturas y presupuestos.",
      done: fiscalMissing ? fiscalMissing.length === 0 : undefined,
      href: "/admin/configuracion/sitio",
    },
    canCatalog && {
      key: "product",
      label: "Crea tu primer producto o servicio",
      hint: "Lo podrás vender en tu tienda y añadir a presupuestos.",
      done: products.data ? products.data.length > 0 : undefined,
      href: "/admin/productos/experiencias?nuevo=1",
    },
    canCrm && sub.can("crm-contacts") && {
      key: "client",
      label: "Da de alta tu primer cliente",
      hint: "Centraliza sus datos, presupuestos, pedidos y facturas.",
      done: clients.data ? clients.data.total > 0 : undefined,
      href: "/admin/crm/clientes?nuevo=1",
    },
    canCrm && sub.can("crm-quotes") && {
      key: "quote",
      label: "Prepara tu primer presupuesto",
      hint: "Envíalo por email y cobra online cuando lo acepten.",
      done: quotesTotal !== undefined ? quotesTotal > 0 : undefined,
      href: "/admin/crm?tab=quotes&nuevo=1",
    },
    isAdmin && sub.can("admin-users") && {
      key: "team",
      label: "Invita a alguien de tu equipo",
      hint: "Cada persona entra con su propio usuario y permisos.",
      done: users.data ? users.data.length > 1 : undefined,
      href: "/admin/usuarios",
    },
  ].filter(Boolean) as Array<{ key: string; label: string; hint: string; done: boolean | undefined; href: string }>;
  const stepsKnown = steps.filter((s) => s.done !== undefined);
  const stepsDone = stepsKnown.filter((s) => s.done).length;
  const allDone = steps.length > 0 && stepsKnown.length === steps.length && stepsDone === steps.length;

  const quick = [
    canCrm && sub.canWrite("crm-contacts") && { label: "Nuevo cliente", href: "/admin/crm/clientes?nuevo=1", icon: UserPlus },
    canCatalog && sub.canWrite("shop-catalog") && { label: "Nuevo producto", href: "/admin/productos/experiencias?nuevo=1", icon: PackagePlus },
    canCrm && sub.canWrite("crm-quotes") && { label: "Nuevo presupuesto", href: "/admin/crm?tab=quotes&nuevo=1", icon: FilePlus2 },
    canSettings && { label: "Configurar empresa", href: "/admin/configuracion/sitio", icon: Building2 },
  ].filter(Boolean) as Array<{ label: string; href: string; icon: typeof UserPlus }>;

  const activityError = [leadCounters, quoteCounters, resCounters].find((q) => q.isError);
  const activityLoading = [leadCounters, quoteCounters, resCounters].some((q) => q.isLoading && q.fetchStatus !== "idle");
  const activityValues = [
    leadCounters.data?.nueva, quoteCounters.data?.enviado, resCounters.data?.pendientePago, resCounters.data?.confirmadas, resCounters.data?.facturas,
  ];
  const noActivity = !activityLoading && !activityError && activityValues.every((v) => !v);

  if (openWizard) return <Redirect to={SETUP_WIZARD_PATH} />;
  return (
    <AdminLayout>
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{firstName ? `Hola, ${firstName}` : "Inicio"}</h1>
          <p className="text-sm text-muted-foreground">Lo que está pasando en tu negocio y lo que tienes pendiente.</p>
        </div>

        {/* Estado de la suscripción (solo si requiere atención) */}
        {data?.trial && isAdmin && (
          <div
            className={cn(
              "rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3",
              data.trial.daysLeft <= 3 ? "border-amber-500/50 bg-amber-500/10" : "border-border bg-muted/40",
            )}
          >
            <Rocket className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
            <p className="flex-1 text-sm text-foreground">
              {data.trial.daysLeft > 0
                ? <>Estás probando <strong>{data.plan?.name ?? "Elephant Source"}</strong>: te {data.trial.daysLeft === 1 ? "queda" : "quedan"} <strong>{data.trial.daysLeft} {data.trial.daysLeft === 1 ? "día" : "días"}</strong>.</>
                : <>Tu prueba ha terminado. Tus datos se conservan en solo lectura.</>}
            </p>
            <Link href="/admin/suscripcion" className="text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
              Ver mi suscripción
            </Link>
          </div>
        )}
        {data && !data.trial && (data.state === "read_only" || data.state === "suspended") && (
          <div role="status" className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-foreground">
            {data.state === "read_only"
              ? "Tu cuenta está en solo lectura: puedes consultar tus datos, pero no crear ni modificar."
              : "Tu suscripción está suspendida. Contacta con tu responsable de cuenta."}{" "}
            <Link href="/admin/suscripcion" className="font-medium underline underline-offset-4">Ver detalles</Link>
          </div>
        )}

        {/* Accesos rápidos */}
        {quick.length > 0 && (
          <nav aria-label="Accesos rápidos" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {quick.map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0" aria-hidden="true">
                  <q.icon className="w-4 h-4" />
                </span>
                {q.label}
              </Link>
            ))}
          </nav>
        )}

        {/* Asistente de configuración inicial (/admin/primeros-pasos): se oculta solo al terminarlo */}
        <SetupWizardLink className="self-start" />

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Pendientes */}
          {isSales && (
            <Section id="home-pending" title="Qué tengo pendiente" description="Avisos que requieren tu atención.">
              {feed.isError ? (
                <PanelError error={feed.error} onRetry={() => feed.refetch()} title="No se han podido cargar los pendientes" />
              ) : feed.isLoading ? (
                <div className="space-y-2" aria-busy="true">
                  <span className="sr-only">Cargando pendientes…</span>
                  {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
                </div>
              ) : pending.length === 0 && myTasks === 0 ? (
                <div className="flex items-start gap-3 text-sm text-muted-foreground">
                  <Inbox className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <p>No tienes nada pendiente. Cuando entren oportunidades, haya presupuestos sin respuesta, cobros vencidos o tareas asignadas a ti, aparecerán aquí.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {myTasks > 0 && (
                    <li>
                      <Link
                        href="/admin/crm/tareas"
                        className="flex items-center gap-3 py-2.5 text-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        <span className="min-w-[28px] h-7 px-2 rounded-full text-xs font-semibold flex items-center justify-center bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200">
                          {myTasks}
                        </span>
                        <span className="flex-1 text-foreground">
                          Mis tareas pendientes
                          {(taskSummary.data?.mineOverdue ?? 0) > 0 && (
                            <span className="ml-1 font-medium text-red-700 dark:text-red-300">({taskSummary.data!.mineOverdue} {taskSummary.data!.mineOverdue === 1 ? "vencida" : "vencidas"})</span>
                          )}
                        </span>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    </li>
                  )}
                  {pending.map((s) => (
                    <li key={s.kind}>
                      <Link
                        href={s.ctaAllPath}
                        className="flex items-center gap-3 py-2.5 text-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      >
                        <span
                          className={cn(
                            "min-w-[28px] h-7 px-2 rounded-full text-xs font-semibold flex items-center justify-center",
                            s.severity === "critical" ? "bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200"
                              : s.severity === "warning" ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"
                                : "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200",
                          )}
                        >
                          {s.total}
                        </span>
                        <span className="flex-1 text-foreground">{FEED_LABELS[s.kind] ?? s.label}</span>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* Primeros pasos */}
          {steps.length > 0 && !allDone && (
            <Section
              id="home-steps"
              title="Primeros pasos"
              description={stepsKnown.length === steps.length ? `${stepsDone} de ${steps.length} completados` : "Configura lo básico para empezar a vender."}
            >
              <ol className="space-y-1">
                {steps.map((s) => (
                  <li key={s.key}>
                    <Link
                      href={s.href}
                      className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {s.done ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <Circle className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className={cn("block text-sm font-medium", s.done ? "text-muted-foreground line-through" : "text-foreground")}>
                          {s.label}
                          <span className="sr-only">{s.done ? " (hecho)" : s.done === false ? " (pendiente)" : ""}</span>
                        </span>
                        {!s.done && <span className="block text-xs text-muted-foreground">{s.hint}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>

        {/* Actividad */}
        {canCrm && (
          <Section id="home-activity" title="Actividad" description="Cifras reales de tu cuenta.">
            {activityError ? (
              <PanelError
                error={activityError.error}
                onRetry={() => { leadCounters.refetch(); quoteCounters.refetch(); resCounters.refetch(); }}
                title="No se ha podido cargar la actividad"
              />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                  {sub.can("crm-leads") && <Stat label="Oportunidades nuevas" value={leadCounters.data?.nueva} href="/admin/crm?tab=leads" loading={leadCounters.isLoading} />}
                  {sub.can("crm-quotes") && <Stat label="Presupuestos enviados" value={quoteCounters.data?.enviado} href="/admin/crm?tab=quotes" loading={quoteCounters.isLoading} />}
                  {sub.can("shop-orders") && <Stat label="Pedidos pendientes de pago" value={resCounters.data?.pendientePago} href="/admin/crm?tab=reservations" loading={resCounters.isLoading} />}
                  {sub.can("shop-orders") && <Stat label="Pedidos confirmados" value={resCounters.data?.confirmadas} href="/admin/crm?tab=reservations" loading={resCounters.isLoading} />}
                  {sub.can("bill-invoices") && <Stat label="Facturas emitidas" value={resCounters.data?.facturas} href="/admin/crm?tab=invoices" loading={resCounters.isLoading} />}
                </div>
                {noActivity && (
                  <p className="text-sm text-muted-foreground mt-4 flex items-center gap-2">
                    <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
                    Aún no hay actividad. En cuanto crees clientes, presupuestos o recibas pedidos, verás aquí la evolución.
                  </p>
                )}
              </>
            )}
          </Section>
        )}
      </div>
    </AdminLayout>
  );
}
