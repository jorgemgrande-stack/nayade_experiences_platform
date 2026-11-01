/**
 * Inicio del panel para empresas con licencias por capacidad (Elephant Core).
 * Accesos rápidos, avisos, estado de configuración (el del asistente), indicadores del negocio, pendientes y actividad
 * reciente, con datos reales del servidor (coreHome.indicators y compañía): no hay métricas inventadas; una cifra a
 * cero explica qué hacer y lleva a hacerlo, y si no se puede leer se dice y se ofrece reintentar. Cada consulta se hace
 * solo si el plan incluye la capacidad y el rol tiene acceso. La primera vez, el administrador ve la bienvenida.
 */
import { Link } from "wouter";
import {
  AlertTriangle, ArrowRight, FilePlus2, FileText, Globe, Inbox, PackagePlus, Receipt, ReceiptText, Rocket, ShoppingCart, Sparkles, Target, UserPlus, Users,
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
import { TONE_BADGE, TONE_SURFACE, TONE_TEXT } from "@/lib/panelTones";

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

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

/**
 * Indicador real. Con valor, enlaza al listado; a cero, explica qué hacer y ofrece la acción (si el plan y el rol la
 * permiten).
 */
function Indicator({ label, value, detail, href, empty, cta }: {
  label: string;
  value: string | null;
  detail?: string | null;
  href: string;
  /** Texto cuando la cifra es cero (null = la cifra no es cero). */
  empty: string | null;
  cta?: { label: string; href: string } | null;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border p-4 flex flex-col">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums break-words">{value}</p>
      {empty === null ? (
        <>
          {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
          <Link href={href} className="mt-auto pt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            Ver detalle <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mt-1">{empty}</p>
          {cta && (
            <Link href={cta.href} className="mt-auto pt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
              {cta.label} <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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

  const canClients = isSales && sub.can("crm-contacts");
  const canQuotes = isSales && sub.can("crm-quotes");
  const canOrders = isSales && sub.can("shop-orders");
  const canInvoices = isSales && sub.can("bill-invoices");
  // La caja (TPV) es de administración (como en el menú)
  const canCash = isAdmin && sub.can("bill-cash");
  const canCatalog = isAdmin && sub.can("shop-catalog");
  const canWeb = isAdmin && (sub.can("cms-pages-forms") || sub.can("cms-editor"));

  const indicators = trpc.coreHome.indicators.useQuery(undefined, { enabled: isSales, retry: 1, staleTime: 30_000 });
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

  // Acción de venta: la caja si se tiene; si no, un pedido
  const saleAction =
    canCash && sub.canWrite("bill-cash") ? { label: "Nueva venta", href: "/admin/tpv" }
      : canOrders && sub.canWrite("shop-orders") ? { label: "Nueva venta", href: "/admin/crm?tab=reservations&nuevo=1" }
        : null;
  const invoiceAction = canInvoices && sub.canWrite("bill-invoices") ? { label: "Nueva factura", href: "/admin/crm?tab=invoices&nuevo=1" } : null;
  const quoteAction = canQuotes && sub.canWrite("crm-quotes") ? { label: "Nuevo presupuesto", href: "/admin/crm?tab=quotes&nuevo=1" } : null;
  const clientAction = canClients && sub.canWrite("crm-contacts") ? { label: "Nuevo cliente", href: "/admin/crm/clientes?nuevo=1" } : null;
  const productAction = canCatalog && sub.canWrite("shop-catalog") ? { label: "Nuevo producto", href: "/admin/productos/experiencias?nuevo=1" } : null;
  const webAction = canWeb ? { label: "Editar mi web", href: "/admin/cms/paginas" } : null;
  const quick = [
    saleAction && { ...saleAction, icon: ShoppingCart },
    invoiceAction && { ...invoiceAction, icon: ReceiptText },
    quoteAction && { ...quoteAction, icon: FilePlus2 },
    clientAction && { ...clientAction, icon: UserPlus },
    productAction && { ...productAction, icon: PackagePlus },
    webAction && { ...webAction, icon: Globe },
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

  // Indicadores: solo los contratados (el servidor devuelve null en los que no) y visibles para el rol
  const ind = indicators.data;
  const cards: Array<React.ComponentProps<typeof Indicator> & { key: string }> = [];
  if (ind?.sales && (canOrders || canCash)) {
    const { today, month } = ind.sales;
    cards.push({
      key: "today", label: "Ventas de hoy", value: eur.format(today.amount), href: "/admin/crm?tab=reservations",
      detail: plural(today.count, "venta cobrada", "ventas cobradas"),
      empty: today.count === 0 ? "Aún no has cobrado ninguna venta hoy." : null, cta: saleAction,
    });
    cards.push({
      key: "month", label: "Ventas del mes", value: eur.format(month.amount), href: sub.can("bill-reports") && isAdmin ? "/admin/contabilidad/dashboard" : "/admin/crm?tab=reservations",
      detail: plural(month.count, "venta cobrada", "ventas cobradas"),
      empty: month.count === 0 ? "Este mes aún no hay ventas cobradas. Cada venta en caja o pedido cobrado suma aquí." : null, cta: saleAction,
    });
  }
  if (ind?.unpaidInvoices && canInvoices) {
    const x = ind.unpaidInvoices;
    cards.push({
      key: "invoices", label: "Facturas pendientes de cobro", value: String(x.count), href: "/admin/crm?tab=invoices",
      detail: `${eur.format(x.amount)} por cobrar`,
      empty: x.count === 0 ? "No tienes facturas por cobrar. Las facturas emitidas que aún no se han pagado aparecen aquí." : null, cta: invoiceAction,
    });
  }
  if (ind?.awaitingQuotes && canQuotes) {
    const x = ind.awaitingQuotes;
    cards.push({
      key: "quotes", label: "Presupuestos sin respuesta", value: String(x.count), href: "/admin/crm?tab=quotes",
      detail: `${eur.format(x.amount)} en presupuestos enviados`,
      empty: x.count === 0 ? "No hay presupuestos enviados esperando respuesta del cliente." : null, cta: quoteAction,
    });
  }
  if (ind?.newClients && canClients) {
    const x = ind.newClients;
    cards.push({
      key: "clients", label: "Clientes nuevos este mes", value: String(x.count), href: "/admin/crm/clientes",
      empty: x.count === 0 ? "Este mes aún no has dado de alta clientes." : null, cta: clientAction,
    });
  }
  if (ind?.pendingOnlineOrders && canOrders) {
    const x = ind.pendingOnlineOrders;
    cards.push({
      key: "online", label: "Pedidos online pendientes", value: String(x.count), href: "/admin/tienda/pedidos",
      detail: "Cobrados y aún sin finalizar",
      empty: x.count === 0 ? "No hay pedidos de tu tienda online por completar. Cuando un cliente compre en tu web, lo verás aquí." : null,
      cta: productAction ? { label: "Revisar mis productos", href: "/admin/productos/experiencias" } : null,
    });
  }

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
                  TONE_SURFACE[n.tone === "warn" ? "warning" : "neutral"],
                )}
              >
                {n.key === "trial" ? <Rocket className="w-5 h-5 text-primary shrink-0" aria-hidden="true" /> : <AlertTriangle className={cn("w-5 h-5 shrink-0", TONE_TEXT.warning)} aria-hidden="true" />}
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
          <nav aria-label="Accesos rápidos" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
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

        {/* Indicadores del negocio (solo los contratados; a cero, con la acción que toca) */}
        {isSales && (indicators.isLoading || indicators.isError || cards.length > 0) && (
          <Section id="home-indicators" title="Tu negocio" description="Cifras reales de tu empresa. Las ventas y los clientes nuevos cuentan desde el día 1 del mes.">
            {indicators.isError ? (
              <PanelError error={indicators.error} onRetry={() => indicators.refetch()} title="No se han podido cargar las cifras" />
            ) : indicators.isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" aria-busy="true">
                <span className="sr-only">Cargando cifras…</span>
                {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {cards.map(({ key, ...c }) => <Indicator key={key} {...c} />)}
              </div>
            )}
          </Section>
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
                        <span className={cn("min-w-[28px] h-7 px-2 rounded-full border text-xs font-semibold flex items-center justify-center", TONE_BADGE.info)}>
                          {myTasks}
                        </span>
                        <span className="flex-1 text-foreground">
                          Mis tareas pendientes
                          {(taskSummary.data?.mineOverdue ?? 0) > 0 && (
                            <span className={cn("ml-1 font-medium", TONE_TEXT.danger)}>({taskSummary.data!.mineOverdue} {taskSummary.data!.mineOverdue === 1 ? "vencida" : "vencidas"})</span>
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
                            "min-w-[28px] h-7 px-2 rounded-full border text-xs font-semibold flex items-center justify-center",
                            TONE_BADGE[s.severity === "critical" ? "danger" : s.severity === "warning" ? "warning" : "info"],
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
                            <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-foreground">{it.title}</span>
                            {it.detail && <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{it.detail}</span>}
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
