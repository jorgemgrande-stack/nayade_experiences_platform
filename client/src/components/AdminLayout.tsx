import { useState, useEffect, useRef } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  LayoutDashboard, Package, FileText, Calendar, BarChart3,
  Settings, Menu, X, LogOut, Users, Image, ChevronDown,
  Bell, User, BedDouble, Sparkles, UtensilsCrossed, AlertCircle,
  UserPlus, FileCheck, ChevronRight, Receipt, Truck, Monitor, Tag, Ticket,
  Sun, Moon, ExternalLink, Target, MessageCircle, Bot, Mail, Building2,
  Briefcase, Globe, CreditCard, ShoppingCart, Rocket, ArrowUpRight, HelpCircle, RefreshCw, Coins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/_core/hooks/useAuth";
import { SupportModeBar, exitSupportMode, isSupportUser } from "@/components/SupportModeBar";
import { WhatsAppNotification } from "./WhatsAppNotification";
import { cn } from "@/lib/utils";
import { useLocation as useWouterLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import MaintenanceModeControl, { maintenanceControlMode } from "./admin/MaintenanceModeControl";

import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { panelChromeQueries } from "@shared/panelChrome";
import { SubscriptionRecoveryBanner } from "./admin/SubscriptionRecoveryBanner";
import { isPanelReadOnlyState } from "@shared/subscriptionRecovery";
import {
  LEGACY_SECTIONS, TASK_NAV, resolveNav,
  type NavIcon, type ResolvedItem, type ResolvedSection,
} from "@shared/adminNav";
import { helpForLocation } from "@shared/helpCenter";
import { discoveredAt, extensionBlocks, isNewExtension } from "@shared/panelNews";
import { useDiscoveredExtensions } from "@/hooks/useDiscoveredExtensions";
import { ROLE_LABELS } from "@shared/roleLabels";
import { AuthRequired, PanelSpinner } from "@/components/auth/AuthRequired";
import { useI18n } from "@/i18n/I18nProvider";
import { ConfirmHost } from "@/components/admin/ConfirmHost";
import LanguageSelect from "@/i18n/LanguageSelect";
import { localizeNav } from "@shared/i18n/navLabels";

/** El plegado del menú lateral se recuerda entre pantallas (cada página monta su propio AdminLayout). */
const SIDEBAR_KEY = "panel.sidebarOpen";
function readSidebarOpen(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) !== "0";
  } catch {
    return true;
  }
}
function saveSidebarOpen(open: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0");
  } catch {
    /* almacenamiento no disponible: solo se pierde la preferencia */
  }
}

/** Iconos del menú (el modelo de navegación vive en shared/adminNav.ts, sin React). */
const NAV_ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, image: Image, package: Package, file: FileText, building: Building2,
  target: Target, calendar: Calendar, briefcase: Briefcase, chart: BarChart3, receipt: Receipt,
  monitor: Monitor, truck: Truck, bed: BedDouble, sparkles: Sparkles, utensils: UtensilsCrossed,
  tag: Tag, users: Users, settings: Settings, globe: Globe, creditCard: CreditCard, coins: Coins,
  shoppingCart: ShoppingCart, rocket: Rocket, message: MessageCircle, bot: Bot, mail: Mail, help: HelpCircle,
};

/** Etiqueta y color por rol */
const ROLE_META: Record<string, { label: string; color: string }> = {
  admin:     { label: ROLE_LABELS.admin,     color: "text-red-400" },
  agente:    { label: ROLE_LABELS.agente,    color: "text-blue-400" },
  monitor:   { label: ROLE_LABELS.monitor,   color: "text-green-400" },
  adminrest: { label: ROLE_LABELS.adminrest, color: "text-orange-400" },
  controler: { label: ROLE_LABELS.controler, color: "text-purple-400" },
  user:      { label: ROLE_LABELS.user,      color: "text-gray-400" },
  readonly:  { label: ROLE_LABELS.readonly,  color: "text-gray-400" },
};

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function AdminLayout({ children, title }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpenState] = useState(readSidebarOpen);
  const setSidebarOpen = (open: boolean) => {
    setSidebarOpenState(open);
    saveSidebarOpen(open);
  };
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [location, navigate] = useWouterLocation();
  const currentSearch = useSearch();
  const { user, logout, loading, isAuthenticated } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t, locale, format } = useI18n();

  const userRole = (user as any)?.role ?? "user";
  const roleMeta = ROLE_META[userRole] ?? ROLE_META.user;
  const roleKey = "roles." + userRole;
  const roleName = locale !== "es" && t(roleKey) !== roleKey ? t(roleKey) : roleMeta.label;

  // ── Guard: redirect adminrest a /admin/restaurantes si intenta acceder a /admin ──
  useEffect(() => {
    if (!loading && isAuthenticated && userRole === "adminrest" && location === "/admin") {
      navigate("/admin/restaurantes");
    }
  }, [loading, isAuthenticated, userRole, location, navigate]);

  // ── Guard: bloquear acceso a rutas no permitidas ──
  useEffect(() => {
    if (!loading && isAuthenticated && userRole === "adminrest") {
      const isRestaurantRoute = location.startsWith("/admin/restaurantes");
      if (!isRestaurantRoute) {
        navigate("/admin/restaurantes");
      }
    }
  }, [loading, isAuthenticated, userRole, location, navigate]);

  // ── Guard: controler solo puede acceder a Control Diario ──
  useEffect(() => {
    if (!loading && isAuthenticated && userRole === "controler") {
      if (!location.startsWith("/admin/contabilidad/control-diario")) {
        navigate("/admin/contabilidad/control-diario");
      }
    }
  }, [loading, isAuthenticated, userRole, location, navigate]);

  // Cerrar menú móvil al cambiar de ruta
  useEffect(() => { setMobileMenuOpen(false); }, [location]);

  // Marca el documento como panel: index.css ajusta ahí los tonos claros heredados para que se lean en modo claro
  useEffect(() => {
    document.documentElement.dataset.adminPanel = "1";
    return () => { delete document.documentElement.dataset.adminPanel; };
  }, []);

  // Menú móvil como diálogo: foco dentro al abrir, Tab no sale del panel, Escape cierra y el foco
  // vuelve al botón que lo abrió
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const opener = menuButtonRef.current;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
        return;
      }
      if (e.key !== "Tab" || !asideRef.current) return;
      const focusables = Array.from(asideRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [mobileMenuOpen]);

  const toggleExpanded = (href: string) => {
    setExpandedItems((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]
    );
  };

  const isActive = (href: string) => {
    if (href === "/admin") return location === "/admin";
    return location === href || location.startsWith(href + "/") || location.startsWith(href + "?");
  };
  // Para sub-items con ?tab= en el href: compara pathname + search
  const isChildActive = (childHref: string) => {
    if (!childHref.includes("?")) return location === childHref;
    const [childPath, childQuery] = childHref.split("?");
    if (location !== childPath) return false;
    // Comparar todos los params del child con la URL actual
    const childParams = new URLSearchParams(childQuery);
    const currentParams = new URLSearchParams(currentSearch);
    for (const [key, val] of Array.from(childParams.entries())) {
      if (currentParams.get(key) !== val) return false;
    }
    return true;
  };

  // Public brand settings — logo, name, colors.
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const LOGO_FALLBACK = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png";
  const brandName = publicSettings?.brand_name || "Admin";

  // Feature flags — used to hide nav items for disabled modules.
  // Defaults to showing all items when flags are not yet loaded (safe fallback).
  // Menú: el de siempre (single / sin licencias por capacidad) o por tareas filtrado por licencias.
  const subscription = usePanelSubscription();
  // Interruptores y avisos solo con la capacidad admin-panel (el plan Life no la tiene: shared/panelChrome.ts)
  const chrome = panelChromeQueries({ isAuthenticated, role: userRole, can: subscription.can });
  const { data: flagsList } = trpc.config.listFeatureFlags.useQuery(undefined, {
    enabled: chrome.featureFlags,
    staleTime: 120_000,
    refetchIntervalInBackground: false,
  });
  const flagsMap = new Map<string, boolean>((flagsList ?? []).map(f => [f.key, f.enabled]));
  const isFlagVisible = (flagKey?: string) => {
    if (!flagKey || !flagsList) return true;
    return flagsMap.get(flagKey) !== false;
  };

  // Módulos disponibles para este tenant (licencia + dependencias + flag), desde el servidor.
  // Mientras carga, o si falla, se muestra todo (la autorización real está en el servidor).
  const { data: modulesData } = trpc.modules.active.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 120_000,
    retry: false,
  });
  const isModuleVisible = (moduleKey?: string) => {
    if (!moduleKey || !modulesData) return true;
    return modulesData.modules.includes(moduleKey);
  };

  // Mantenimiento de la web: el control técnico solo en single; en multiempresa, «Web en mantenimiento» si gestiona web
  const maintenanceMode = maintenanceControlMode({ role: userRole, install: subscription.install, canWeb: subscription.can("cms-editor") });
  const navSections: ResolvedSection[] =
    subscription.mode === "loading" || subscription.mode === "error"
      ? []
      : localizeNav(resolveNav(subscription.mode === "tasks" ? TASK_NAV : LEGACY_SECTIONS, {
          role: userRole,
          isFlagVisible,
          isModuleVisible,
          capabilityState: subscription.mode === "tasks" ? subscription.capabilityState : () => "active",
        }, subscription.extensions), locale);
  const isTaskNav = subscription.mode === "tasks";
  // Prueba o suscripción terminada (o restringida): todo el panel en consulta (shared/subscriptionRecovery.ts)
  const panelReadOnly = isTaskNav && isPanelReadOnlyState(subscription.data?.state);
  // «Nuevo» en las extensiones recién activadas hasta que la persona entra en ellas (shared/panelNews.ts)
  const { discovered, markDiscovered } = useDiscoveredExtensions((user as { id?: string | number } | null)?.id ?? null);
  const extensionBlocksSig = JSON.stringify(extensionBlocks(navSections));
  useEffect(() => {
    const ids = discoveredAt(location, JSON.parse(extensionBlocksSig));
    if (ids.length) markDiscovered(ids);
  }, [location, extensionBlocksSig, markDiscovered]);
  const nowMs = Date.now();
  // Ayuda contextual de la pantalla actual (contenido en shared/helpCenter.ts)
  const contextHelp = isTaskNav ? helpForLocation(location, currentSearch, locale) : undefined;
  const upgradeUrl = subscription.data?.upgradeUrl ?? null;
  const trialInfo = subscription.data?.trial ?? null;
  // Una empresa nueva sin logo propio no hereda el de la instalación original: se muestra su inicial.
  // El logo de siempre solo en la instalación de una sola empresa (nunca por un fallo ni en multiempresa).
  const isSingleInstall = (subscription.install ?? subscription.data?.mode) === "single";
  const brandLogo = publicSettings?.brand_logo_url || (subscription.mode === "legacy" && isSingleInstall ? LOGO_FALLBACK : null);

  // ── Feed unificado de notificaciones (polling cada 60s) ─────────────────
  // El endpoint `notifications.feed` agrega 6 fuentes (leads, quotes,
  // cancellations, pending_payments, tpv_alerts, upcoming_reservations),
  // excluyendo los items que este usuario ya ha silenciado.
  const utils = trpc.useUtils();
  const { data: feed } = trpc.notifications.feed.useQuery(undefined, {
    enabled: chrome.notifications,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const totalAlerts = feed?.totalAlerts ?? 0;
  // Para mantener compat con badges del menú lateral (sidebar) que usan
  // estas dos variables para mostrar el punto rojo en CRM.
  const newLeads = feed?.sections.find(s => s.kind === "lead")?.total ?? 0;
  const pendingQuotes = feed?.sections.find(s => s.kind === "quote")?.total ?? 0;

  const dismissItem = trpc.notifications.dismiss.useMutation({
    onSuccess: () => utils.notifications.feed.invalidate(),
  });
  const dismissAllSection = trpc.notifications.dismissAll.useMutation({
    onSuccess: () => utils.notifications.feed.invalidate(),
  });

  const sectionLabel = (kind: string, fallback: string) => {
    const key = "shell.notifications.kind." + kind;
    return locale !== "es" && t(key) !== key ? t(key) : fallback;
  };
  type FeedKind = "lead" | "quote" | "cancellation" | "pending_payment" | "tpv_alert" | "upcoming_reservation" | "task" | "community" | "automation";
  const severityColor: Record<string, string> = {
    info:     "text-sky-400",
    warning:  "text-amber-400",
    critical: "text-red-400",
  };
  const severityBg: Record<string, string> = {
    info:     "bg-sky-500/10 border-sky-500/30",
    warning:  "bg-amber-500/10 border-amber-500/30",
    critical: "bg-red-500/10 border-red-500/30",
  };

  // ── Los empleados no acceden al panel de admin: enviarlos a su portal ──
  // Evita el callejón sin salida de "Sin permisos" cuando un empleado abre /admin.
  useEffect(() => {
    if (!loading && isAuthenticated && userRole === "employee") {
      navigate("/empleado");
    }
  }, [loading, isAuthenticated, userRole, navigate]);

  // ── Loading state ──
  if (loading) return <PanelSpinner />;

  // ── Sin sesión: al inicio de sesión de la empresa y de vuelta a esta pantalla ──
  if (!isAuthenticated) return <AuthRequired returnTo={location} />;

  // ── Role not allowed for any admin section ──
  if (!["admin", "agente", "monitor", "adminrest", "controler", "readonly"].includes(userRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-sm px-4">
          <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-2">{t("shell.noPermissions.title")}</h2>
          <p className="text-muted-foreground mb-6">{t("shell.noPermissions.text")}</p>
          <Button variant="outline" onClick={() => navigate("/")}>{t("shell.noPermissions.home")}</Button>
        </div>
      </div>
    );
  }

  // En móvil el panel siempre se muestra completo (con textos), aunque en escritorio esté plegado.
  const showLabels = sidebarOpen || mobileMenuOpen;
  const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";

  // Avisos numéricos del menú por tareas (mismos datos que la campana).
  const badgeFor = (item: ResolvedItem): { n: number; tone: "red" | "amber"; label: string } | null => {
    if (!isTaskNav) return null;
    if (item.key === "t-oportunidades" && newLeads > 0) return { n: newLeads, tone: "red", label: t("shell.menu.badgeLeads") };
    if (item.key === "t-presupuestos" && pendingQuotes > 0) return { n: pendingQuotes, tone: "amber", label: t("shell.menu.badgeQuotes") };
    return null;
  };

  const renderNavItem = (item: ResolvedItem) => {
    const Icon = NAV_ICONS[item.icon] ?? LayoutDashboard;
    const active = isActive(item.href);
    const id = item.key ?? item.href;
    const badge = badgeFor(item);
    const badgeEl = badge && (
      <span
        className={cn(
          "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold px-1",
          badge.tone === "red" ? "bg-red-600" : "bg-amber-600",
        )}
      >
        {badge.n > 99 ? "99+" : badge.n}
        <span className="sr-only"> {badge.label}</span>
      </span>
    );
    const isNew = isNewExtension(item.extension, discovered, nowMs);
    const newTag = isNew && showLabels && <NewPill />;
    // Con todo el panel en consulta no se repite en cada apartado (lo explica el aviso único); con el plan en
    // vigor y una función suelta en solo lectura, sí se marca esa función
    const readOnlyTag = item.readOnly && showLabels && !panelReadOnly && (
      <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-sidebar-accent text-sidebar-foreground/80">{t("shell.menu.readOnly")}</span>
    );

    if (item.children) {
      const isExpanded = expandedItems.includes(id) || active || item.children.some((c) => isChildActive(c.href));
      const panelId = `nav-${id.replace(/[^a-z0-9-]/gi, "-")}`;
      return (
        <li key={id}>
          <button
            type="button"
            onClick={() => (showLabels ? toggleExpanded(id) : setSidebarOpen(true))}
            aria-expanded={showLabels ? isExpanded : undefined}
            aria-controls={showLabels ? panelId : undefined}
            title={showLabels ? undefined : item.label}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
              focusRing,
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            <NavIconWithDot Icon={Icon} dot={isNew && !showLabels} />
            {showLabels ? (
              <>
                <span className="flex-1 text-left">{item.label}</span>
                {readOnlyTag}
                {newTag}
                {badgeEl}
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isExpanded && "rotate-180")} aria-hidden="true" />
              </>
            ) : (
              <span className="sr-only">{item.label}</span>
            )}
          </button>
          {showLabels && isExpanded && (
            <ul id={panelId} className="ml-4 mt-1 space-y-0.5">
              {item.children.map((child) => {
                const childActive = isChildActive(child.href);
                return (
                  <li key={child.key ?? child.href}>
                    <Link
                      href={child.href}
                      aria-current={childActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
                        focusRing,
                        childActive
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-[inset_2px_0_0_var(--sidebar-primary)]"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      )}
                    >
                      <span className="flex-1">{child.label}</span>
                      {child.readOnly && !panelReadOnly && <span className="text-[10px] text-sidebar-foreground/70">{t("shell.menu.readOnly")}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      );
    }

    const leafActive = item.href.includes("?") ? isChildActive(item.href) : active;
    return (
      <li key={id}>
        <Link
          href={item.href}
          aria-current={leafActive ? "page" : undefined}
          title={showLabels ? undefined : item.label}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
            focusRing,
            leafActive
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
          )}
        >
          <NavIconWithDot Icon={Icon} dot={isNew && !showLabels} />
          {showLabels ? (
            <>
              <span className="flex-1">{item.label}</span>
              {readOnlyTag}
                {newTag}
              {badgeEl}
            </>
          ) : (
            <span className="sr-only">{item.label}</span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-background flex">
      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-ring"
      >
        {t("shell.skipToContent")}
      </a>
      {/* Mobile backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        ref={asideRef}
        id="panel-sidebar"
        role={mobileMenuOpen ? "dialog" : undefined}
        aria-modal={mobileMenuOpen ? true : undefined}
        aria-label={mobileMenuOpen ? t("shell.menu.label") : undefined}
        className={cn(
          "fixed left-0 top-0 h-full z-50 flex flex-col transition-all duration-300",
          "bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
          // Desktop: respeta sidebarOpen toggle
          sidebarOpen ? "lg:w-64" : "lg:w-16",
          // Móvil: siempre ancho completo pero se oculta con translate
          "w-64",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-sidebar-border shrink-0">
          <Link
            href={userRole === "adminrest" ? "/admin/restaurantes" : "/admin"}
            className="flex items-center gap-2 min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label={t("shell.brand.home", { brand: brandName })}
          >
            {brandLogo ? (
              <img
                src={brandLogo}
                alt=""
                className={cn("object-contain rounded-full shrink-0", showLabels ? "h-10 w-10" : "h-8 w-8")}
              />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  "rounded-full shrink-0 bg-sidebar-primary text-sidebar-primary-foreground font-display font-bold flex items-center justify-center",
                  showLabels ? "h-10 w-10 text-base" : "h-8 w-8 text-sm",
                )}
              >
                {brandName.trim().charAt(0).toUpperCase() || "A"}
              </span>
            )}
            {showLabels && (
              isTaskNav || !isSingleInstall ? (
                <span className="text-sm font-display font-semibold text-sidebar-foreground overflow-hidden text-ellipsis whitespace-nowrap">{brandName}</span>
              ) : (
                <span className="text-xs text-accent tracking-widest uppercase font-display font-bold shrink-0">
                  {userRole === "adminrest" ? t("shell.brand.restaurants") : userRole === "controler" ? t("shell.brand.control") : t("shell.brand.admin")}
                </span>
              )
            )}
          </Link>
          {/* Escritorio: plegar/desplegar; móvil: cerrar el panel */}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => (mobileMenuOpen ? setMobileMenuOpen(false) : setSidebarOpen(!sidebarOpen))}
            aria-label={mobileMenuOpen ? t("shell.menu.close") : sidebarOpen ? t("shell.menu.collapse") : t("shell.menu.expand")}
            aria-expanded={mobileMenuOpen || sidebarOpen}
            className="ml-auto w-8 h-8 rounded-lg hover:bg-sidebar-accent flex items-center justify-center text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            {showLabels ? <X className="w-4 h-4" aria-hidden="true" /> : <Menu className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2" aria-label={t("shell.menu.label")}>
          {subscription.mode === "loading" && (
            <div className="space-y-2 px-1" aria-busy="true" aria-live="polite">
              <span className="sr-only">{t("shell.menu.loading")}</span>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-9 rounded-lg bg-sidebar-accent/60 animate-pulse" />
              ))}
            </div>
          )}
          {subscription.mode === "error" && (
            <div role="alert" className={cn("px-2 py-3 text-sm text-sidebar-foreground/80", !showLabels && "flex justify-center")}>
              {showLabels && <p className="mb-2">{t("shell.menu.loadError")}</p>}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={subscription.retry}
                className={cn(showLabels ? "w-full" : "w-9 px-0")}
                aria-label={t("shell.menu.reload")}
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                {showLabels && <span className="ml-1.5">{t("shell.menu.retry")}</span>}
              </Button>
            </div>
          )}
          {navSections.map((section) => (
            <div
              key={section.id}
              className={cn(
                "mb-3",
                // Sección de una extensión contratada: bloque diferenciado con los colores del propio menú
                section.extension && "rounded-xl border border-sidebar-border bg-sidebar-accent/40 px-1 pb-1",
              )}
              data-extension={section.extension?.moduleId}
            >
              {section.label && showLabels && (
                <p className="flex items-center gap-2 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
                  <span className="flex-1">{section.label}</span>
                  {isNewExtension(section.extension, discovered, nowMs) && <NewPill />}
                </p>
              )}
              {section.label && !showLabels && <div className="mx-3 my-2 border-t border-sidebar-border" aria-hidden="true" />}
              <ul className="space-y-1" aria-label={section.label ?? undefined}>
                {section.items.map((item) => renderNavItem(item))}
              </ul>
            </div>
          ))}
          {/* Ampliar: lo no contratado no aparece como activo; solo un acceso separado para ampliar */}
          {isTaskNav && userRole === "admin" && (
            <div className="mt-2 pt-3 border-t border-sidebar-border">
              {showLabels && (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">{t("shell.menu.upgrade")}</p>
              )}
              {upgradeUrl ? (
                <a
                  href={upgradeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  title={showLabels ? undefined : t("shell.menu.seePlansTitle")}
                >
                  <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {showLabels ? <span className="flex-1">{t("shell.menu.seePlans")}</span> : <span className="sr-only">{t("shell.menu.seePlans")}</span>}
                  <span className="sr-only">{t("shell.menu.newTab")}</span>
                </a>
              ) : (
                <Link
                  href="/admin/suscripcion#ampliar"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  title={showLabels ? undefined : t("shell.menu.upgradePlan")}
                >
                  <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {showLabels ? <span className="flex-1">{t("shell.menu.upgradePlan")}</span> : <span className="sr-only">{t("shell.menu.upgradePlan")}</span>}
                </Link>
              )}
            </div>
          )}
        </nav>

        {/* User Profile */}
        <div className="border-t border-sidebar-border p-3 shrink-0">
          <div className={cn("flex items-center gap-3", !showLabels && "justify-center")}>
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0" aria-hidden="true">
              <User className="w-4 h-4 text-accent" />
            </div>
            {showLabels && (
              <div className="flex-1 min-w-0">
                <Link href="/admin/mi-cuenta" className="block text-xs font-semibold text-sidebar-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring rounded overflow-hidden text-ellipsis whitespace-nowrap" title={t("shell.user.myAccount")}>{user?.name ?? t("shell.user.fallbackName")}</Link>
                <p className={cn("text-xs font-medium capitalize", roleMeta.color)}>{roleName}</p>
              </div>
            )}
            <button
              type="button"
              onClick={isSupportUser(user) ? () => void exitSupportMode() : logout}
              className="w-8 h-8 rounded-lg hover:bg-sidebar-accent flex items-center justify-center text-sidebar-foreground/70 hover:text-red-400 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              title={isSupportUser(user) ? t("shell.user.exitSupport") : t("shell.user.logout")}
              aria-label={isSupportUser(user) ? t("shell.user.exitSupport") : t("shell.user.logout")}
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className={cn("flex-1 flex flex-col transition-all duration-300 min-w-0", sidebarOpen ? "lg:ml-64" : "lg:ml-16")}>
        {/* Top Bar */}
        <header className="h-16 bg-card border-b border-border flex items-center px-3 sm:px-6 gap-2 sm:gap-3 sticky top-0 z-30 min-w-0">
          {/* Hamburguesa — solo en móvil */}
          <button
            ref={menuButtonRef}
            type="button"
            className="lg:hidden w-9 h-9 rounded-lg hover:bg-accent flex items-center justify-center text-foreground/60 hover:text-foreground transition-colors shrink-0"
            onClick={() => setMobileMenuOpen(true)}
            aria-label={t("shell.menu.open")}
            aria-expanded={mobileMenuOpen}
            aria-controls="panel-sidebar"
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
          {title && (
            <h1 className="font-display font-semibold text-base sm:text-lg text-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0">{title}</h1>
          )}
          {/* Acciones: desde xl con etiqueta; por debajo, solo icono (aria-label y title) para no desbordar entre 640 y 1280 px */}
          <div className="ml-auto flex items-center gap-1 sm:gap-2 xl:gap-3 shrink-0">
            {/* Prueba gratuita: días restantes (dato del servidor) */}
            {/* Terminada la prueba no se repite aquí: lo dice el aviso único de recuperación */}
            {isTaskNav && trialInfo && trialInfo.daysLeft > 0 && userRole === "admin" && (
              <Link
                href="/admin/suscripcion"
                title={t("shell.trial", { days: trialInfo.daysLeft })}
                aria-label={t("shell.trial", { days: trialInfo.daysLeft })}
                className={cn(
                  "hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 xl:px-3 py-1 text-xs font-medium whitespace-nowrap",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  trialInfo.daysLeft <= 3
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                    : "border-border bg-muted text-foreground",
                )}
              >
                <Rocket className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden xl:inline">{t("shell.trial", { days: trialInfo.daysLeft })}</span>
                <span className="xl:hidden" aria-hidden="true">{trialInfo.daysLeft}</span>
              </Link>
            )}
            {maintenanceMode && <MaintenanceModeControl mode={maintenanceMode} />}
            <LanguageSelect />
            {/* Toggle Light / Dark */}
            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9"
              onClick={toggleTheme}
              title={theme === "dark" ? t("shell.theme.toLight") : t("shell.theme.toDark")}
              aria-label={theme === "dark" ? t("shell.theme.toLight") : t("shell.theme.toDark")}
            >
              {theme === "dark"
                ? <Sun className="w-4 h-4 text-amber-400" />
                : <Moon className="w-4 h-4" />
              }
            </Button>
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-9 h-9 relative"
                  title={totalAlerts > 0 ? t("shell.notifications.summary", { leads: newLeads, quotes: pendingQuotes }) : t("shell.notifications.none")}
                  aria-label={totalAlerts > 0 ? t("shell.notifications.someAria", { count: totalAlerts }) : t("shell.notifications.noneAria")}
                >
                  <Bell className="w-4 h-4" aria-hidden="true" />
                  {totalAlerts > 0 && (
                    <span className="absolute top-1 right-1 min-w-[16px] h-[16px] rounded-full bg-danger text-background text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                      {totalAlerts > 99 ? "99+" : totalAlerts}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[min(24rem,calc(100vw-1rem))] p-0 bg-card border border-border shadow-xl max-h-[80vh] overflow-y-auto"
                align="end"
                sideOffset={8}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
                  <span className="text-sm font-semibold text-foreground">{t("shell.notifications.title")}</span>
                  {totalAlerts > 0 && (
                    <span className="text-xs bg-danger text-background rounded-full px-2 py-0.5 font-bold">
                      {totalAlerts}
                    </span>
                  )}
                </div>

                {/* Secciones del feed */}
                {(feed?.sections ?? []).filter(s => s.total > 0).map((section) => (
                  <div key={section.kind} className="border-b border-border last:border-b-0">
                    <div className="flex items-center justify-between px-4 pt-3 pb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base leading-none">{section.icon}</span>
                        <span className={`text-xs font-semibold uppercase tracking-wide ${severityColor[section.severity]}`}>
                          {sectionLabel(section.kind, section.label)} ({section.total})
                        </span>
                      </div>
                      <button
                        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => dismissAllSection.mutate({ kind: section.kind as FeedKind })}
                        disabled={dismissAllSection.isPending}
                        title={t("shell.notifications.markSection")}
                      >
                        {t("shell.notifications.markAll")}
                      </button>
                    </div>
                    <div className="space-y-1 px-2 pb-2">
                      {section.items.map((item) => (
                        <div
                          key={`${item.kind}-${item.entityId}`}
                          className={`flex items-stretch gap-1 rounded-md border ${severityBg[item.severity]} group`}
                        >
                          <button
                            className="flex-1 text-left px-2 py-1.5 hover:bg-foreground/[0.04] transition-colors min-w-0"
                            onClick={() => { navigate(item.ctaPath); setNotifOpen(false); }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                                {item.title}
                              </span>
                              {item.amount != null && (
                                <span className="text-xs font-semibold text-emerald-400 shrink-0">
                                  {format.currency(item.amount)}
                                </span>
                              )}
                            </div>
                            {item.subtitle && (
                              <div className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                                {item.subtitle}
                              </div>
                            )}
                          </button>
                          <button
                            className="px-2 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              dismissItem.mutate({ kind: item.kind as FeedKind, entityId: item.entityId });
                            }}
                            disabled={dismissItem.isPending}
                            title={t("shell.notifications.markSeen")}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {section.total > section.items.length && (
                        <button
                          className="w-full text-[11px] text-muted-foreground hover:text-foreground text-center py-1"
                          onClick={() => { navigate(section.ctaAllPath); setNotifOpen(false); }}
                        >
                          {t("shell.notifications.seeRemaining", { count: section.total - section.items.length })}
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Estado vacío */}
                {totalAlerts === 0 && (feed?.sections.every(s => s.total === 0) ?? true) && (
                  <div className="px-4 py-8 text-center">
                    <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">{t("shell.notifications.empty")}</p>
                  </div>
                )}

                {/* Footer */}
                <div className="px-4 py-2 border-t border-border sticky bottom-0 bg-card">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground hover:text-foreground justify-center"
                    onClick={() => { navigate("/admin/crm"); setNotifOpen(false); }}
                  >
                    {t("shell.notifications.seeAllCrm")}
                    <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            {isTaskNav && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 px-2 xl:px-3 text-xs gap-1.5" title={t("shell.help.button")} aria-label={contextHelp ? t("shell.help.onScreen", { title: contextHelp.title }) : t("shell.help.button")}>
                    <HelpCircle className="w-4 h-4" aria-hidden="true" />
                    <span className="hidden xl:inline">{t("shell.help.button")}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-4">
                  {contextHelp ? (
                    <>
                      <p className="text-sm font-semibold text-foreground">{contextHelp.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{contextHelp.summary}</p>
                      <Link href={`/admin/ayuda/${contextHelp.id}`} className="mt-3 inline-flex text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                        {t("shell.help.guide")}
                      </Link>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("shell.help.general")}</p>
                  )}
                  <Link href="/admin/ayuda" className="mt-2 block text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                    {t("shell.help.center")}
                  </Link>
                </PopoverContent>
              </Popover>
            )}
            {userRole !== "adminrest" && (
              <Link href="/" target="_blank" title={t("shell.viewSite")} aria-label={t("shell.viewSite")}>
                <Button variant="outline" size="sm" className="text-xs hidden xl:inline-flex whitespace-nowrap" tabIndex={-1}>
                  {t("shell.viewSite")}
                </Button>
                <Button variant="ghost" size="icon" className="xl:hidden w-9 h-9" tabIndex={-1} aria-hidden="true">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </Link>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main id="contenido-principal" tabIndex={-1} className="flex-1 p-4 sm:p-6 overflow-auto focus:outline-none">
          {isTaskNav && <SubscriptionRecoveryBanner role={userRole} />}
          {children}
        </main>
        <ConfirmHost />
        {/* Modo soporte de Big Elephant: banda permanente con operador, modo, caducidad y salida */}
        {isSupportUser(user) && <SupportModeBar user={user} />}
      </div>
      {/* Solo con WhatsApp contratado: si no, consultaría cada 15 s una ruta que el servidor deniega */}
      {subscription.mode !== "loading" && subscription.can("whatsapp-ai") && <WhatsAppNotification />}
    </div>
  );
}

/** Marca discreta de una extensión recién activada (desaparece al entrar en ella). */
function NewPill() {
  const { t } = useI18n();
  return (
    <span className="shrink-0 rounded-full bg-sidebar-primary/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-sidebar-primary">
      {t("shell.menu.new")}
    </span>
  );
}

/** Icono del menú con un punto de «Nuevo» cuando el menú está plegado. */
function NavIconWithDot({ Icon, dot }: { Icon: React.ComponentType<{ className?: string }>; dot: boolean }) {
  const { t } = useI18n();
  return (
    <span className="relative shrink-0">
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      {dot && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-sidebar-primary" aria-hidden="true" />}
      {dot && <span className="sr-only"> {t("shell.menu.newDot")}</span>}
    </span>
  );
}
