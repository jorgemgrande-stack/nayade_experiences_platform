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
import { getErm, installErmFromEnv } from "../erm/runtime";
import { configureModuleAccess } from "../modules/runtime";
import { warmConfigCache } from "../../config";
import { warmIntegrationCreds } from "../credentials/runtime";
import { configureSupport, createSupportRouter, supportReadOnlyGuard } from "../support/session";
import { writableTenantLister } from "./jobs";
import { createTenantRuntime, type TenantRuntime } from "./runtime";
import { setJobPrelude, setJobTenantLister } from "./scheduler";
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
    // Las tareas programadas recorren los tenants con escrituras del registro
    setJobTenantLister(writableTenantLister(rt.reader));
    // Las tareas también necesitan las credenciales del tenant en curso
    setJobPrelude(() => Promise.all([warmConfigCache(), warmIntegrationCreds()]).then(() => undefined));
    // Las licencias de módulos se leen del registro (solo lectura)
    configureModuleAccess(rt.entitlements);
    // Medición + cuotas por tenant (límites del registro; consumo en ERM_DATABASE_URL)
    installErmFromEnv(rt.quotas, env);
    // Acceso delegado de soporte (inactivo sin SUPPORT_JWT_SECRET)
    configureSupport(rt.support, env.SUPPORT_JWT_SECRET);
  }
  return rt;
}

export function installTenantBinding(app: Express): void {
  if (!isMultiTenant()) return;
  app.use(bindTenantMiddleware());
  // Tasa y concurrencia por tenant: ya con el contexto ligado
  const erm = getErm();
  if (erm) app.use(erm.guard);
  // Precarga los ajustes del tenant (lecturas síncronas: Redsys, remitente de correo…)
  app.use((_req, _res, next) => {
    Promise.all([warmConfigCache(), warmIntegrationCreds()]).then(() => next(), () => next());
  });
  // Soporte: lectura impuesta en el borde y puerta de entrada
  app.use(supportReadOnlyGuard());
  app.use(createSupportRouter());
}
