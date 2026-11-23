/**
 * Inicio del panel para empresas con licencias por capacidad (Elephant Core).
 * Accesos rápidos, avisos, estado de configuración (el del asistente), indicadores del negocio, pendientes y actividad
 * reciente, con datos reales del servidor (coreHome.indicators y compañía): no hay métricas inventadas; una cifra a
 * cero explica qué hacer y lleva a hacerlo, y si no se puede leer se dice y se ofrece reintentar. Cada consulta se hace
 * solo si el plan incluye la capacidad y el rol tiene acceso. La primera vez, el administrador ve la bienvenida.
 */
import { Link } from "wouter";
import {
  AlertTriangle, ArrowRight, Banknote, ChevronDown, CalendarDays, ChevronRight, FilePlus2, FileText, Globe, Inbox, PackagePlus, Receipt, ReceiptText, Rocket, ShoppingCart, Sparkles, Target, UserPlus, Users, Wallet,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { MetricCard } from "@/components/admin/PanelVisual";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { PanelError } from "@/components/admin/PanelStates";
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";
import { SETUP_WIZARD_PATH } from "@/components/SetupWizardLink";
import { SetupStatusCard } from "@/components/onboarding/SetupStatusCard";
import { TrialFirstSteps } from "@/components/onboarding/TrialFirstSteps";
import { PLANS_HREF, trialConversionHref } from "@shared/subscriptionRecovery";
import { configurationSteps, shouldOpenSetupWizard } from "@shared/setupWizard";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { TONE_BADGE, TONE_SURFACE, TONE_TEXT } from "@/lib/panelTones";
import { OperationalPanelCard } from "./OperationalPanelCard";

/** Texto con partes en negrita marcadas como <b>…</b> (las traducciones colocan la negrita donde su gramática la pide). */
function rich(text: string): React.ReactNode {
  return text.split(/(<b>.*?<\/b>)/g).map((part, i) => (part.startsWith("<b>") ? <strong key={i}>{part.slice(3, -4)}</strong> : part));
}

const RECENT_ICONS = { client: Users, lead: Target, quote: FileText, order: ShoppingCart, invoice: Receipt, sale: Receipt } as const;

function Section({ id, title, description, children, className, action, bare, compact }: { compact?: boolean; bare?: boolean; id: string; title: string; description?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className={cn("min-w-0", bare ? "" : "rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={id} className={cn("font-semibold text-foreground", compact && "sr-only")}>{title}</h2>
          {description && !compact && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      <div className={compact ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

const INDICATOR_LOOK: Record<string, { icon: React.ReactNode; tone: "brand" | "info" | "success" | "warning" | "danger" }> = {
  today: { icon: <Banknote />, tone: "success" },
  month: { icon: <CalendarDays />, tone: "brand" },
  invoices: { icon: <Wallet />, tone: "warning" },
  quotes: { icon: <FileText />, tone: "info" },
  clients: { icon: <UserPlus />, tone: "brand" },
  online: { icon: <ShoppingCart />, tone: "info" },
};

/**
 * Indicador real. Con valor, enlaza al listado; a cero, explica qué hacer y ofrece la acción (si el plan y el rol la
 * permiten).
 */
function Indicator({ id, label, value, detail, href, empty, cta }: {
  id: string;
  label: string;
  value: string | null;
  detail?: string | null;
  href: string;
  /** Texto cuando la cifra es cero (null = la cifra no es cero). */
  empty: string | null;
  cta?: { label: string; href: string } | null;
}) {
  const { t } = useI18n();
  const look = INDICATOR_LOOK[id] ?? { icon: <Sparkles />, tone: "brand" as const };
  if (empty === null) {
    return <MetricCard compact icon={look.icon} tone={look.tone} label={label} value={value} detail={detail} href={href} />;
  }
  return (
    <MetricCard
      compact
      icon={look.icon}
      tone="neutral"
      label={label}
      value={value}
      hint={empty}
      action={cta ? (
        <Link href={cta.href} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {cta.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    />
  );
}

const ACTIVITY_DATE: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

export default function EssentialHome() {
  const { t, format: f } = useI18n();
  const FEED_LABELS: Record<string, string> = {
    lead: t("home.feed.lead"),
    quote: t("home.feed.quote"),
    cancellation: t("home.feed.cancellation"),
    pending_payment: t("home.feed.pending_payment"),
    tpv_alert: t("home.feed.tpv_alert"),
    upcoming_reservation: t("home.feed.upcoming_reservation"),
    task: t("home.feed.task"),
    community: t("home.feed.community"),
  };
  const { user } = useAuth();
  const role = (user as { role?: string } | null)?.role ?? "user";
  const isAdmin = role === "admin";
  const isSales = role === "admin" || role === "agente";
  const sub = usePanelSubscription();
  const data = sub.data;
  // Estado de configuración: una sola fuente, el asistente (solo quien configura la empresa)
  const wizard = trpc.setupWizard.status.useQuery(undefined, { enabled: isAdmin, retry: false, staleTime: 60_000 });
  // Prueba en curso: contratar el plan que se prueba desde el propio panel (mismo destino que al terminar la prueba)
  const inTrial = !!data?.trial && data.trial.daysLeft > 0;
  const conversion = trpc.subscription.conversionStatus.useQuery(undefined, { enabled: isAdmin && inTrial, retry: false, staleTime: 300_000 });

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
    canCash && sub.canWrite("bill-cash") ? { label: t("home.quick.newSale"), href: "/admin/tpv" }
      : canOrders && sub.canWrite("shop-orders") ? { label: t("home.quick.newSale"), href: "/admin/crm?tab=reservations&nuevo=1" }
        : null;
  const invoiceAction = canInvoices && sub.canWrite("bill-invoices") ? { label: t("home.quick.newInvoice"), href: "/admin/crm?tab=invoices&nuevo=1" } : null;
  const quoteAction = canQuotes && sub.canWrite("crm-quotes") ? { label: t("home.quick.newQuote"), href: "/admin/crm?tab=quotes&nuevo=1" } : null;
  const clientAction = canClients && sub.canWrite("crm-contacts") ? { label: t("home.quick.newClient"), href: "/admin/crm/clientes?nuevo=1" } : null;
  const productAction = canCatalog && sub.canWrite("shop-catalog") ? { label: t("home.quick.newProduct"), href: "/admin/productos/experiencias?nuevo=1" } : null;
  const webAction = canWeb ? { label: t("home.quick.editWeb"), href: "/admin/studio" } : null;
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
  // Prueba terminada, solo lectura o suspensión: los explica el aviso único de recuperación del panel (AdminLayout)
  if (data?.trial && inTrial && isAdmin) {
    const planName = data.plan?.name ?? "Elephant Core";
    notices.push({
      key: "trial",
      tone: data.trial.daysLeft <= 3 ? "warn" : "info",
      text: <>{rich(t("home.notice.trial", { plan: planName, days: data.trial.daysLeft }))}</>,
      href: trialConversionHref(data.plan?.key, conversion.data?.enabled),
      // Sin contratación desde la prueba (o mientras se comprueba) se ofrecen los planes, sin prometer el pago aquí
      cta: trialConversionHref(data.plan?.key, conversion.data?.enabled) === PLANS_HREF ? t("home.notice.seePlans") : t("home.notice.contract", { plan: planName }),
    });
  }
  if (w && !w.facts.fiscal && sub.can("bill-invoices")) {
    notices.push({ key: "fiscal", tone: "warn", text: t("home.notice.fiscal"), href: SETUP_WIZARD_PATH, cta: t("home.notice.fiscalCta") });
  }

  // Indicadores: solo los contratados (el servidor devuelve null en los que no) y visibles para el rol
  const ind = indicators.data;
  const cards: Array<Omit<React.ComponentProps<typeof Indicator>, "id"> & { key: string }> = [];
  if (ind?.sales && (canOrders || canCash)) {
    const { today, month } = ind.sales;
    cards.push({
      key: "today", label: t("home.cards.salesToday"), value: f.currency(today.amount), href: "/admin/crm?tab=reservations",
      detail: t("home.cards.paidSales", { n: today.count }),
      empty: today.count === 0 ? t("home.cards.emptyToday") : null, cta: saleAction,
    });
    cards.push({
      key: "month", label: t("home.cards.salesMonth"), value: f.currency(month.amount), href: sub.can("bill-reports") && isAdmin ? "/admin/contabilidad/dashboard" : "/admin/crm?tab=reservations",
      detail: t("home.cards.paidSales", { n: month.count }),
      empty: month.count === 0 ? t("home.cards.emptyMonth") : null, cta: saleAction,
    });
  }
  if (ind?.unpaidInvoices && canInvoices) {
    const x = ind.unpaidInvoices;
    cards.push({
      key: "invoices", label: t("home.cards.unpaidInvoices"), value: String(x.count), href: "/admin/crm?tab=invoices",
      detail: t("home.cards.toCollect", { amount: f.currency(x.amount) }),
      empty: x.count === 0 ? t("home.cards.emptyInvoices") : null, cta: invoiceAction,
    });
  }
  if (ind?.awaitingQuotes && canQuotes) {
    const x = ind.awaitingQuotes;
    cards.push({
      key: "quotes", label: t("home.cards.awaitingQuotes"), value: String(x.count), href: "/admin/crm?tab=quotes",
      detail: t("home.cards.sentQuotes", { amount: f.currency(x.amount) }),
      empty: x.count === 0 ? t("home.cards.emptyQuotes") : null, cta: quoteAction,
    });
  }
  if (ind?.newClients && canClients) {
    const x = ind.newClients;
    cards.push({
      key: "clients", label: t("home.cards.newClients"), value: String(x.count), href: "/admin/crm/clientes",
      empty: x.count === 0 ? t("home.cards.emptyClients") : null, cta: clientAction,
    });
  }
  if (ind?.pendingOnlineOrders && canOrders) {
    const x = ind.pendingOnlineOrders;
    cards.push({
      key: "online", label: t("home.cards.onlineOrders"), value: String(x.count), href: "/admin/tienda/pedidos",
      detail: t("home.cards.onlineDetail"),
      empty: x.count === 0 ? t("home.cards.emptyOnline") : null,
      cta: productAction ? { label: t("home.cards.reviewProducts"), href: "/admin/productos/experiencias" } : null,
    });
  }

  // Primera entrada del administrador de una empresa nueva: bienvenida a pantalla completa
  if (isAdmin && w && shouldOpenSetupWizard(w.progress)) {
    return <WelcomeScreen firstName={firstName} tradeName={w.company.tradeName} steps={configurationSteps(w.plan.steps).length} />;
  }
  return (
    <AdminLayout>
      <div className="max-w-[1680px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border pb-4">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{firstName ? t("home.hello", { name: firstName }) : t("home.title")}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("home.subtitle")}</p>
          </div>
          {quick.length > 0 && (
            <nav aria-label={t("home.quick.aria")} className="flex items-center gap-2">
              <Button asChild>
                <Link href={quick[0].href}>
                  {(() => { const Q = quick[0].icon; return <Q className="h-4 w-4" aria-hidden="true" />; })()}
                  {quick[0].label}
                </Link>
              </Button>
              {quick.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      {t("home.quick.more")} <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52">
                    {quick.slice(1).map((q) => (
                      <DropdownMenuItem key={q.href} asChild>
                        <Link href={q.href} className="flex items-center gap-2">
                          <q.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          {q.label}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </nav>
          )}
        </header>

        {/* Avisos */}
        {notices.length > 0 && (
          <div className="space-y-2" role="region" aria-label={t("home.notice.aria")}>
            {notices.map((n) => (
              <div
                key={n.key}
                className={cn(
                  "rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-3",
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

        {/* Indicadores del negocio (solo los contratados; a cero, con la acción que toca) */}
        {isSales && (indicators.isLoading || indicators.isError || cards.length > 0) && (
          <Section bare id="home-indicators" title={t("home.business.title")} description={t("home.business.description")} compact>
            {indicators.isError ? (
              <PanelError error={indicators.error} onRetry={() => indicators.refetch()} title={t("home.business.loadError")} />
            ) : indicators.isLoading ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6" aria-busy="true">
                <span className="sr-only">{t("home.business.loading")}</span>
                {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
                {cards.map(({ key, ...c }) => <Indicator key={key} id={key} {...c} />)}
              </div>
            )}
          </Section>
        )}

        {/* Primera sesión de la prueba: datos de la empresa, primer cliente y primer presupuesto (omitible y retomable) */}
        {isAdmin && inTrial && w && (
          <TrialFirstSteps facts={w.facts} can={{ clients: canClients && sub.canWrite("crm-contacts"), quotes: canQuotes && sub.canWrite("crm-quotes") }} />
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:items-start">
          <div className="min-w-0 space-y-5">
          <OperationalPanelCard enabled={isAdmin} />
          {/* Actividad reciente */}
          {isSales && (
            <Section id="home-recent" title={t("home.recent.title")}>
              {recent.isError ? (
                <PanelError error={recent.error} onRetry={() => recent.refetch()} title={t("home.recent.loadError")} />
              ) : recent.isLoading ? (
                <div className="space-y-2" aria-busy="true">
                  <span className="sr-only">{t("home.recent.loading")}</span>
                  {[0, 1, 2].map((i) => <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />)}
                </div>
              ) : (recent.data?.items.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">{t("home.recent.none")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {recent.data!.items.map((it, i) => {
                    const Icon = RECENT_ICONS[it.kind];
                    return (
                      <li key={`${it.kind}-${it.at}-${i}`}>
                        <Link href={it.href} className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true"><Icon className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-foreground">{it.title}</span>
                            {it.detail && <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{it.detail}</span>}
                          </span>
                          <time className="shrink-0 text-xs text-muted-foreground" dateTime={new Date(it.at).toISOString()}>
                            {f.dateTime(it.at, ACTIVITY_DATE)}
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
          <div className="min-w-0 space-y-5">
          {/* Pendientes */}
          {isSales && (
            <Section id="home-pending" title={t("home.pending.title")} description={t("home.pending.description")}>
              {feed.isError ? (
                <PanelError error={feed.error} onRetry={() => feed.refetch()} title={t("home.pending.loadError")} />
              ) : feed.isLoading ? (
                <div className="space-y-2" aria-busy="true">
                  <span className="sr-only">{t("home.pending.loading")}</span>
                  {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
                </div>
              ) : pending.length === 0 && myTasks === 0 ? (
                <div className="flex items-start gap-3 text-sm text-muted-foreground">
                  <Inbox className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <p>{t("home.pending.none")}</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {myTasks > 0 && (
                    <li>
                      <Link
                        href="/admin/crm/tareas"
                        className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className={cn("min-w-[28px] h-7 px-2 rounded-full border text-xs font-semibold flex items-center justify-center", TONE_BADGE.info)}>
                          {myTasks}
                        </span>
                        <span className="flex-1 text-foreground">
                          {t("home.pending.myTasks")}
                          {(taskSummary.data?.mineOverdue ?? 0) > 0 && (
                            <span className={cn("ml-1 font-medium", TONE_TEXT.danger)}>{t("home.pending.overdue", { n: taskSummary.data!.mineOverdue })}</span>
                          )}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </Link>
                    </li>
                  )}
                  {pending.map((s) => (
                    <li key={s.kind}>
                      <Link
                        href={s.ctaAllPath}
                        className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}


          {/* Estado de configuración (asistente): se oculta cuando está terminado y todo hecho */}
          {showSetup && w && <SetupStatusCard plan={w.plan} />}
          </div>
        </div>

        {/* Extensiones recomendadas: hueco discreto hacia «Ampliar» */}
        {isAdmin && (
          <Link
            href="/admin/ampliar"
            className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Sparkles className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="flex-1">{t("home.extensions")}</span>
            <ArrowRight className="w-4 h-4 shrink-0" aria-hidden="true" />
          </Link>
        )}
      </div>
    </AdminLayout>
  );
}
