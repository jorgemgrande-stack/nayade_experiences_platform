/**
 * Navegación dinámica del panel: aportaciones de las extensiones (contrato de módulo 1.2, campo `panel`).
 *
 * Fuentes: módulos del registro (incorporados y externos de `ELEPHANT_MODULES`), extras de Connect que viven en
 * el Core (`CONNECT_EXTENSIONS`) y módulos del SDK. Para cada una, solo se devuelven sus entradas si:
 *  - su `coreRange` es compatible con la versión del Core;
 *  - su capacidad está activa o en solo lectura (suspendida, cancelada o sin contratar: nada);
 *  - si es un módulo del registro que no va en la base, además tiene la licencia de módulo vigente;
 *  - el rol del usuario y, si la entrada lo pide, su permiso la permiten.
 * Las rutas (`routes`) se devuelven siempre, con o sin licencia: el guardián del cliente las bloquea.
 *
 * Además, los namespaces tRPC que declaran (`panel.api`) se añaden a los guardianes del servidor.
 * Solo presentación para el menú; la autorización real sigue en cada operación.
 */
import { panelEntries, panelRoutes, type PanelNavEntry, type PanelNavigation, type PanelRoute } from "../../../shared/panelExtensions";
import { READONLY_ROLE } from "../../../shared/adminNav";
import { CONNECT_EXTENSIONS, registerBuiltinModules } from "./builtin";
import type { ModuleManifest } from "./contract";
import { getModuleRegistry } from "./runtime";
import { satisfies } from "./semver";
import { getSdkRuntime } from "../../sdk/runtime";

export interface PanelExtensionSource {
  manifest: ModuleManifest;
  /** Capacidad que licencia la extensión (manifiesto o definición del SDK). */
  capability: string | null;
  /** Exige además la licencia de módulo (módulo del registro que no va incluido en la base). */
  requiresModuleLicense: boolean;
  /** Módulo por sede (SDK): su licencia la aplica el propio módulo en cada operación. */
  siteScoped: boolean;
}

/** Extensiones con aportaciones al panel instaladas en este proceso (sin repetir id; gana la primera). */
export function panelExtensionSources(): PanelExtensionSource[] {
  registerBuiltinModules();
  const out: PanelExtensionSource[] = [];
  const seen = new Set<string>();
  const push = (s: PanelExtensionSource) => {
    if (!s.manifest.panel || seen.has(s.manifest.id)) return;
    seen.add(s.manifest.id);
    out.push(s);
  };
  for (const m of getModuleRegistry().list()) push({ manifest: m, capability: m.capability ?? null, requiresModuleLicense: !m.includedInBase, siteScoped: false });
  for (const m of CONNECT_EXTENSIONS) push({ manifest: m, capability: m.capability ?? null, requiresModuleLicense: false, siteScoped: false });
  for (const d of getSdkRuntime().registry.list()) push({ manifest: d.manifest, capability: d.capability, requiresModuleLicense: false, siteScoped: d.siteScoped });
  return out;
}

export interface PanelNavigationDeps {
  coreVersion: string;
  role: string;
  /** Estado de una capacidad para el menú (el mismo que `subscription.overview`). */
  capabilityState: (capabilityId: string) => "active" | "read_only" | null;
  /** Licencia de módulo + dependencias + flag operativo. */
  moduleAvailable: (moduleId: string) => Promise<boolean>;
  hasPermission: (key: string) => Promise<boolean>;
}

const navRole = (role: string) => (role === READONLY_ROLE ? "agente" : role);

/** Aportaciones visibles para el usuario y rutas de todas las extensiones (función pura salvo `deps`). */
export async function resolvePanelNavigation(sources: PanelExtensionSource[], deps: PanelNavigationDeps): Promise<PanelNavigation> {
  const entries: PanelNavEntry[] = [];
  const routes: PanelRoute[] = [];
  const role = navRole(deps.role);
  for (const s of sources) {
    const panel = s.manifest.panel;
    if (!panel) continue;
    routes.push(...panelRoutes(panel, s.capability));
    if (!satisfies(deps.coreVersion, s.manifest.coreRange)) continue;
    if (s.capability && !deps.capabilityState(s.capability)) continue;
    if (s.requiresModuleLicense && !(await deps.moduleAvailable(s.manifest.id))) continue;
    // Permisos que piden sus entradas (se consultan una vez)
    const wanted = new Set<string>();
    const collect = (l: { permission?: string; children?: Array<{ permission?: string }> }) => {
      if (l.permission) wanted.add(l.permission);
      for (const ch of l.children ?? []) if (ch.permission) wanted.add(ch.permission);
    };
    for (const i of [...(panel.section?.items ?? []), ...(panel.items ?? []), ...(panel.tabs ?? []), ...(panel.settings ?? [])]) collect(i);
    const granted = new Set<string>();
    for (const k of Array.from(wanted)) if (await deps.hasPermission(k)) granted.add(k);
    entries.push(
      ...panelEntries(s.manifest.id, panel, s.capability, {
        roleAllowed: (roles) => roles.includes(role),
        hasPermission: (k) => granted.has(k),
        capabilitiesVisible: (caps) => caps.some((c) => deps.capabilityState(c) !== null),
      }),
    );
  }
  return { entries, routes };
}

/** namespace tRPC → capacidad, de las extensiones que lo declaran (las de sede se protegen en el módulo). */
export function extensionCapabilityRoutes(sources: PanelExtensionSource[] = panelExtensionSources()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sources) {
    if (!s.capability || s.siteScoped) continue;
    for (const ns of s.manifest.panel?.api ?? []) if (!(ns in out)) out[ns] = s.capability;
  }
  return out;
}

/** namespace tRPC → módulo, de los módulos del registro con licencia propia que lo declaran. */
export function extensionModuleRoutes(sources: PanelExtensionSource[] = panelExtensionSources()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of sources) {
    if (!s.requiresModuleLicense) continue;
    for (const ns of s.manifest.panel?.api ?? []) if (!(ns in out)) out[ns] = s.manifest.id;
  }
  return out;
}
