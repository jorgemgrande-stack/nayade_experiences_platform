/**
 * Puntos de montaje del registro en Express (dos líneas en `_core/index.ts`).
 *
 *   const tenantRuntime = installTenantResolution(app);   // antes de los parsers de cuerpo
 *   installTenantBinding(app);                             // después de los parsers
 *
 *  - single (defecto): no hace nada.
 *  - shadow: observa y compara; NUNCA bloquea ni cambia de BD (ver shadow.ts).
 *  - multi: resuelve el tenant por host y entra en su contexto; lo no servible se rechaza.
 */
import type { Express } from "express";
import { getTenantMode, isMultiTenant } from "../tenant";
import { createTenantRuntime, type TenantRuntime } from "./runtime";
import { shadowMiddleware } from "./shadow";
import { bindTenantMiddleware, resolveTenantMiddleware } from "./tenantMiddleware";

export function installTenantResolution(app: Express, env: NodeJS.ProcessEnv = process.env): TenantRuntime | null {
  const mode = getTenantMode();
  if (mode === "single") return null;

  let rt: TenantRuntime | null = null;
  try {
    rt = createTenantRuntime(env);
  } catch (e) {
    // multi sin registro configurado: el arranque falla (nunca se sirve sin tenant)
    if (mode === "multi") throw e;
    console.warn(JSON.stringify({ ctx: "TenantRuntime", event: "shadow_disabled" }));
  }
  if (!rt) return null;

  if (mode === "shadow") {
    app.use(shadowMiddleware(rt.resolver, { currentTenantId: env.TENANT_SHADOW_CURRENT_ID || "nayade" }));
  } else {
    app.use(resolveTenantMiddleware(rt.resolver));
  }
  return rt;
}

export function installTenantBinding(app: Express): void {
  if (isMultiTenant()) app.use(bindTenantMiddleware());
}
