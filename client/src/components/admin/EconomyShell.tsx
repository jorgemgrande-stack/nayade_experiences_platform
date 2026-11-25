/**
 * Estructura común de Economía y contabilidad: una sola cabecera con el nombre único de la pantalla (h1), una línea de
 * descripción opcional y la acción principal; y la navegación contextual en dos niveles (Hoy · Movimientos · TPV ·
 * Resultados y, dentro de cada grupo, sus pantallas). En móvil, un único selector con el nombre de la pantalla.
 *
 * Solo presentación: las rutas, los permisos y el contenido de cada pantalla no cambian. Las pantallas que aparecen son
 * las que el menú lateral mostraría a esa persona (`shared/economyNav.ts`).
 *
 * Uso: <EconomyShell screen="expenses" description="…" action={<Button>Nuevo gasto</Button>}>…contenido…</EconomyShell>
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SCROLL_NAV, TAB_BASE, TAB_OFF, TAB_ON, useScrollFade } from "@/components/admin/SalesFamilyShell";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import {
  ECONOMY_GROUPS,
  economyScreen,
  groupScreens,
  subScreens,
  visibleEconomyScreens,
  type EconomyGroupId,
  type EconomyScreen,
  type EconomyScreenId,
} from "@shared/economyNav";

/** Pantallas visibles para esta persona (la actual siempre se incluye). `null` mientras no se sabe qué licencias tiene. */
function useEconomyScreens(current: EconomyScreen): EconomyScreen[] | null {
  const { user } = useAuth();
  const sub = usePanelSubscription();
  const role = (user as { role?: string } | null)?.role ?? "user";
  const ready = sub.mode === "tasks" || sub.mode === "legacy";
  return useMemo(() => {
    if (!ready) return null;
    const visible = visibleEconomyScreens({
      role,
      mode: sub.mode === "tasks" ? "tasks" : "legacy",
      capabilityState: sub.capabilityState,
      extensionRoutes: sub.extensionRoutes,
    });
    return visible.some((s) => s.id === current.id) ? visible : [...visible, current];
    // `capabilityState` cambia en cada render; solo importan el modo y las licencias recibidas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role, sub.mode, sub.data, sub.extensionRoutes, current.id]);
}

export function EconomyShell({ screen, description, action, headerExtra, children, className }: {
  screen: EconomyScreenId;
  /** Una línea que explica qué se hace aquí (opcional). */
  description?: ReactNode;
  /** Acción principal de la pantalla («Nuevo gasto»…) y, junto a ella, las secundarias. */
  action?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const current = economyScreen(screen);
  const visible = useEconomyScreens(current);
  const name = t(`economyShell.screen.${screen}`);
  const activeGroup = current.group;
  const siblings = visible ? groupScreens(activeGroup, visible) : [];
  // Subsecciones: la pantalla activa es Gastos o una de sus subpantallas
  const familyId = current.parent ?? current.id;
  const subs = visible ? subScreens(familyId, visible) : [];
  return (
    <div data-economy-shell="" className={cn("min-w-0 space-y-3 px-4 pb-8 pt-2 sm:px-6 sm:pt-3", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 max-sm:basis-full sm:flex-1">
          <h1 className="min-w-0 text-xl font-semibold tracking-tight text-foreground">
            <span className="hidden overflow-hidden text-ellipsis whitespace-nowrap sm:block">{name}</span>
            <EconomySectionMenu visible={visible} current={current} name={name} className="sm:hidden" />
          </h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
        {headerExtra && <div className="flex shrink-0 items-center">{headerExtra}</div>}
        {action && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:justify-start max-sm:[&>button]:min-h-10">{action}</div>}
      </div>
      {visible && (
        <div className="hidden space-y-1.5 sm:block">
          <div className="min-w-0 space-y-1.5 lg:flex lg:items-center lg:gap-3 lg:space-y-0">
            <EconomyGroupTabs visible={visible} active={activeGroup} />
            {siblings.length > 1 && <EconomyScreenTabs screens={siblings} activeId={familyId} className="lg:min-w-0 lg:flex-1" />}
          </div>
          {subs.length > 1 && <EconomySubTabs screens={subs} activeId={current.id} />}
        </div>
      )}
      {children}
    </div>
  );
}

/** Primer nivel: los cuatro grupos. Cada uno lleva a su primera pantalla visible (o a la actual si es el grupo activo). */
function EconomyGroupTabs({ visible, active }: { visible: EconomyScreen[]; active: EconomyGroupId }) {
  const { t } = useI18n();
  const groups = ECONOMY_GROUPS.map((g) => ({ id: g, first: groupScreens(g, visible)[0] })).filter((g) => g.first);
  if (groups.length < 2) return null;
  return (
    <nav aria-label={t("economyShell.groupsLabel")} className="min-w-0 lg:shrink-0">
      <div className="inline-flex gap-0.5 rounded-xl border border-border bg-card/80 p-1 shadow-sm">
        {groups.map((g) => {
          const on = g.id === active;
          return (
            <Link key={g.id} href={g.first!.href} aria-current={on ? "true" : undefined} className={cn(TAB_BASE, on ? TAB_ON : TAB_OFF)}>
              {t(`economyShell.group.${g.id}`)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Segundo nivel: las pantallas del grupo activo, con desvanecido en el borde si no caben. */
function EconomyScreenTabs({ screens, activeId, className }: { screens: EconomyScreen[]; activeId: EconomyScreenId; className?: string }) {
  const { t } = useI18n();
  const scroll = useScrollFade<HTMLElement>(`${activeId}-${screens.length}`);
  return (
    <nav ref={scroll.ref} onScroll={scroll.onScroll} aria-label={t("economyShell.screensLabel")} style={scroll.style} className={cn(SCROLL_NAV, className)}>
      <div className="inline-flex min-w-max gap-0.5">
        {screens.map((s) => {
          const on = s.id === activeId;
          return (
            <Link key={s.id} href={s.href} aria-current={on ? "page" : undefined} data-active={on} className={cn(TAB_BASE, on ? "bg-foreground/[0.07] text-foreground ring-1 ring-inset ring-border" : TAB_OFF)}>
              {t(`economyShell.screen.${s.id}`)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Tercer nivel: Gastos y sus subpantallas (Recurrentes, Proveedores, Categorías, Centros de coste). */
function EconomySubTabs({ screens, activeId }: { screens: EconomyScreen[]; activeId: EconomyScreenId }) {
  const { t } = useI18n();
  const scroll = useScrollFade<HTMLElement>(`sub-${activeId}-${screens.length}`);
  return (
    <nav ref={scroll.ref} onScroll={scroll.onScroll} aria-label={t("economyShell.subLabel")} style={scroll.style} className={SCROLL_NAV}>
      <div className="inline-flex min-w-max gap-1.5">
        {screens.map((s) => {
          const on = s.id === activeId;
          return (
            <Link
              key={s.id}
              href={s.href}
              aria-current={on ? "page" : undefined}
              data-active={on}
              className={cn(
                "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
              )}
            >
              {t(`economyShell.short.${s.id}` as "economyShell.short.expenses")}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Móvil: el nombre de la pantalla es el selector de todas las demás, agrupadas. Siempre hay un botón con el nombre aunque no haya más. */
function EconomySectionMenu({ visible, current, name, className }: { visible: EconomyScreen[] | null; current: EconomyScreen; name: string; className?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (!visible || visible.filter((s) => !s.parent || s.id === current.id).length < 2) {
    return <span className={cn("block overflow-hidden text-ellipsis whitespace-nowrap", className)}>{name}</span>;
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${t("economyShell.navLabel")}: ${name}`}
          className={cn("inline-flex h-10 max-w-full items-center gap-1.5 rounded-lg px-1 text-left text-lg font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
        >
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-72 overflow-y-auto p-1.5">
        <nav aria-label={t("economyShell.navLabel")} className="flex flex-col gap-0.5">
          {ECONOMY_GROUPS.map((g) => {
            const items = visible.filter((s) => s.group === g);
            if (items.length === 0) return null;
            return (
              <div key={g} role="group" aria-label={t(`economyShell.group.${g}`)} className="flex flex-col gap-0.5">
                <p className="px-3 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`economyShell.group.${g}`)}</p>
                {items.map((s) => {
                  const on = s.id === current.id;
                  return (
                    <Link
                      key={s.id}
                      href={s.href}
                      aria-current={on ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        s.parent && "pl-6",
                        on ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
                      )}
                    >
                      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{t(`economyShell.screen.${s.id}`)}</span>
                      {on && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
      </PopoverContent>
    </Popover>
  );
}
