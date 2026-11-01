/**
 * Inicio del panel para empresas con licencias por capacidad (Elephant Core).
 * Estado de configuración (el del asistente), avisos, pendientes, clientes y oportunidades, ventas y facturación,
 * actividad reciente y accesos rápidos, con datos reales del servidor: no hay métricas inventadas; si una cifra no
 * se puede leer se dice y se ofrece reintentar. Cada consulta se hace solo si el plan incluye la capacidad y el rol
 * tiene acceso. La primera vez, el administrador ve la bienvenida en lugar del panel.
 */
import { Link } from "wouter";
import {
  AlertTriangle, ArrowRight, Building2, FilePlus2, FileText, Inbox, PackagePlus, Receipt, Rocket, ShoppingCart, Sparkles, Target, UserPlus, Users,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { PanelError } from "@/components/admin/PanelStates";
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";
import { SETUP_WIZARD_PATH } from "@/components/SetupWizardLink";
import { SetupStatusCard } from "@/components/onboarding/SetupStatusCard";
import { configurationSteps, shouldOpenSetupWizard } from "@shared/setupWizard";
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

const RECENT_ICONS = { client: Users, lead: Target, quote: FileText, order: ShoppingCart, invoice: Receipt, sale: Receipt } as const;

function Section({ id, title, description, children, className, action }: { id: string; title: string; description?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className={cn("min-w-0 rounded-2xl border border-border bg-card p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className="font-semibold text-foreground">{title}</h2>
          {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
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

const dateFmt = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function EssentialHome() {
  const { user } = useAuth();
  const role = (user as { role?: string } | null)?.role ?? "user";
  const isAdmin = role === "admin";
  const isSales = role === "admin" || role === "agente";
  const sub = usePanelSubscription();
  const data = sub.data;
  // Estado de configuración: una sola fuente, el asistente (solo quien configura la empresa)
  const wizard = trpc.setupWizard.status.useQuery(undefined, { enabled: isAdmin, retry: false, staleTime: 60_000 });

  const canCrm = isSales && sub.can("crm-leads");
  const canClients = isSales && sub.can("crm-contacts");
  const canQuotes = isSales && sub.can("crm-quotes");
  const canOrders = isSales && sub.can("shop-orders");
  const canInvoices = isSales && sub.can("bill-invoices");
  const canCatalog = isAdmin && sub.can("shop-catalog");
  const canSettings = isAdmin && sub.can("admin-panel");

  const leadCounters = trpc.crm.leads.counters.useQuery(undefined, { enabled: canCrm, retry: 1 });
  const quoteCounters = trpc.crm.quotes.counters.useQuery(undefined, { enabled: canCrm && canQuotes, retry: 1 });
  const resCounters = trpc.crm.reservations.counters.useQuery(undefined, { enabled: canCrm && (canOrders || canInvoices), retry: 1 });
  const clients = trpc.crm.clients.list.useQuery({ limit: 1, offset: 0 }, { enabled: canCrm && canClients, retry: 1 });
  const feed = trpc.notifications.feed.useQuery(undefined, { enabled: isSales, refetchInterval: 60_000, refetchIntervalInBackground: false });
  const canTasks = isSales && sub.can("crm-tasks");
  const taskSummary = trpc.crmTasks.summary.useQuery(undefined, { enabled: canTasks, retry: 1 });
  const recent = trpc.coreHome.recentActivity.useQuery(undefined, { enabled: isSales, retry: 1, staleTime: 30_000 });

  const firstName = (user?.name ?? "").trim().split(/\s+/)[0];
  const pending = (feed.data?.sections ?? []).filter((s) => s.total > 0);
  // Mis tareas pendientes (además de las de hoy o vencidas que ya avisa el feed)
  const myTasks = canTasks ? taskSummary.data?.minePending ?? 0 : 0;

  const w = wizard.data;
  const showSetup = !!w && !(w.plan.completedAt !== null && w.plan.steps.every((s) => s.status === "done"));

  const quick = [
    canClients && sub.canWrite("crm-contacts") && { label: "Nuevo cliente", href: "/admin/crm/clientes?nuevo=1", icon: UserPlus },
    canCatalog && sub.canWrite("shop-catalog") && { label: "Nuevo producto", href: "/admin/productos/experiencias?nuevo=1", icon: PackagePlus },
    canQuotes && sub.canWrite("crm-quotes") && { label: "Nuevo presupuesto", href: "/admin/crm?tab=quotes&nuevo=1", icon: FilePlus2 },
    canSettings && { label: "Datos de la empresa", href: "/admin/configuracion/sitio", icon: Building2 },
  ].filter(Boolean) as Array<{ label: string; href: string; icon: typeof UserPlus }>;

  // Avisos: solo lo que requiere atención, con datos reales
  const notices: Array<{ key: string; tone: "warn" | "info"; text: React.ReactNode; href: string; cta: string }> = [];
  if (data?.trial && isAdmin) {
    notices.push({
      key: "trial",
      tone: data.trial.daysLeft <= 3 ? "warn" : "info",
      text:
        data.trial.daysLeft > 0 ? (
          <>Estás probando <strong>{data.plan?.name ?? "Elephant Core"}</strong>: te {data.trial.daysLeft === 1 ? "queda" : "quedan"} <strong>{data.trial.daysLeft} {data.trial.daysLeft === 1 ? "día" : "días"}</strong>.</>
        ) : (
          <>Tu prueba ha terminado. Tus datos se conservan en solo lectura.</>
        ),
      href: "/admin/suscripcion",
      cta: "Ver mi suscripción",
    });
  }
  if (data && !data.trial && (data.state === "read_only" || data.state === "suspended")) {
    notices.push({
      key: "state",
      tone: "warn",
      text: data.state === "read_only" ? "Tu cuenta está en solo lectura: puedes consultar tus datos, pero no crear ni modificar." : "Tu suscripción está suspendida. Contacta con tu responsable de cuenta.",
      href: "/admin/suscripcion",
      cta: "Ver detalles",
    });
  }
  if (w && !w.facts.fiscal && sub.can("bill-invoices")) {
    notices.push({ key: "fiscal", tone: "warn", text: "Faltan los datos fiscales de tu empresa: sin ellos no podrás emitir facturas.", href: SETUP_WIZARD_PATH, cta: "Completarlos" });
  }

  const salesError = [quoteCounters, resCounters].find((q) => q.isError);
  const salesValues = [quoteCounters.data?.enviado, quoteCounters.data?.borrador, resCounters.data?.pendientePago, resCounters.data?.confirmadas, resCounters.data?.facturas];
  const noSales = !quoteCounters.isLoading && !resCounters.isLoading && !salesError && salesValues.every((v) => !v);
  const crmError = [leadCounters, clients].find((q) => q.isError);
  const showSales = canCrm && (canQuotes || canOrders || canInvoices);

  // Primera entrada del administrador de una empresa nueva: bienvenida a pantalla completa
  if (isAdmin && w && shouldOpenSetupWizard(w.progress)) {
    return <WelcomeScreen firstName={firstName} tradeName={w.company.tradeName} steps={configurationSteps(w.plan.steps).length} />;
  }
  return (
    <AdminLayout>
      <div className="max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{firstName ? `Hola, ${firstName}` : "Inicio"}</h1>
          <p className="text-sm text-muted-foreground">Lo que está pasando en tu negocio y lo que tienes pendiente.</p>
        </div>

        {/* Avisos */}
        {notices.length > 0 && (
          <div className="space-y-2" role="region" aria-label="Avisos">
            {notices.map((n) => (
              <div
                key={n.key}
                className={cn(
                  "rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3",
                  n.tone === "warn" ? "border-amber-500/50 bg-amber-500/10" : "border-border bg-muted/40",
                )}
              >
                {n.key === "trial" ? <Rocket className="w-5 h-5 text-primary shrink-0" aria-hidden="true" /> : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />}
                <p className="flex-1 text-sm text-foreground">{n.text}</p>
                <Link href={n.href} className="text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                  {n.cta}
                </Link>
              </div>
            ))}
          </div>
        )}

        {/* Accesos rápidos */}
        {quick.length > 0 && (
          <nav aria-label="Accesos rápidos" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {quick.map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0" aria-hidden="true">
                  <q.icon className="w-4 h-4" />
                </span>
                <span className="min-w-0">{q.label}</span>
              </Link>
            ))}
          </nav>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Estado de configuración (asistente): se oculta cuando está terminado y todo hecho */}
          {showSetup && w && <SetupStatusCard plan={w.plan} />}

          {/* Pendientes */}
          {isSales && (
            <Section id="home-pending" title="Tareas y pendientes" description="Avisos que requieren tu atención.">
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

          {/* Clientes y oportunidades */}
          {canCrm && (
            <Section id="home-crm" title="Clientes y oportunidades">
              {crmError ? (
                <PanelError error={crmError.error} onRetry={() => { leadCounters.refetch(); clients.refetch(); }} title="No se han podido cargar los clientes" />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {canClients && <Stat label="Clientes" value={clients.data?.total} href="/admin/crm/clientes" loading={clients.isLoading} />}
                  <Stat label="Oportunidades nuevas" value={leadCounters.data?.nueva} href="/admin/crm?tab=leads" loading={leadCounters.isLoading} />
                </div>
              )}
            </Section>
          )}

          {/* Ventas y facturación (si procede) */}
          {showSales && (
            <Section id="home-sales" title="Ventas y facturación" description="Cifras reales de tu cuenta.">
              {salesError ? (
                <PanelError error={salesError.error} onRetry={() => { quoteCounters.refetch(); resCounters.refetch(); }} title="No se han podido cargar las ventas" />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {canQuotes && <Stat label="Presupuestos enviados" value={quoteCounters.data?.enviado} href="/admin/crm?tab=quotes" loading={quoteCounters.isLoading} />}
                    {canOrders && <Stat label="Pedidos pendientes de pago" value={resCounters.data?.pendientePago} href="/admin/crm?tab=reservations" loading={resCounters.isLoading} />}
                    {canOrders && <Stat label="Pedidos confirmados" value={resCounters.data?.confirmadas} href="/admin/crm?tab=reservations" loading={resCounters.isLoading} />}
                    {canInvoices && <Stat label="Facturas emitidas" value={resCounters.data?.facturas} href="/admin/crm?tab=invoices" loading={resCounters.isLoading} />}
                  </div>
                  {noSales && <p className="text-sm text-muted-foreground mt-4">Aún no hay ventas. En cuanto prepares presupuestos o recibas pedidos, verás aquí la evolución.</p>}
                </>
              )}
            </Section>
          )}

          {/* Actividad reciente */}
          {isSales && (
            <Section id="home-recent" title="Actividad reciente">
              {recent.isError ? (
                <PanelError error={recent.error} onRetry={() => recent.refetch()} title="No se ha podido cargar la actividad" />
              ) : recent.isLoading ? (
                <div className="space-y-2" aria-busy="true">
                  <span className="sr-only">Cargando actividad…</span>
                  {[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />)}
                </div>
              ) : (recent.data?.items.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Aún no hay movimientos. Aquí verás los últimos clientes, oportunidades, presupuestos, pedidos y facturas.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {recent.data!.items.map((it, i) => {
                    const Icon = RECENT_ICONS[it.kind];
                    return (
                      <li key={`${it.kind}-${it.at}-${i}`}>
                        <Link href={it.href} className="flex items-center gap-3 py-2.5 text-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                          <Icon className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-foreground">{it.title}</span>
                            {it.detail && <span className="block truncate text-xs text-muted-foreground">{it.detail}</span>}
                          </span>
                          <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(it.at).toISOString()}>
                            {dateFmt.format(new Date(it.at))}
                          </time>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          )}
        </div>

        {/* Extensiones recomendadas: hueco discreto hacia «Ampliar» */}
        {isAdmin && (
          <Link
            href="/admin/ampliar"
            className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Sparkles className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="flex-1">Extensiones recomendadas para tu negocio</span>
            <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
          </Link>
        )}
      </div>
    </AdminLayout>
  );
}
