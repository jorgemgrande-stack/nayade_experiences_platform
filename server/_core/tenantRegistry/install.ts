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
import { configureCapabilityAccess } from "../capabilities/access";
import { configureLimitAccess } from "../limits/access";
import { warmConfigCache } from "../../config";
import { warmIntegrationCreds } from "../credentials/runtime";
import { configureTenantIdentity, warmTenantIdentity } from "../tenantIdentity";
import { configureSupport, createSupportRouter, supportReadOnlyGuard } from "../support/session";
import { writableTenantLister } from "./jobs";
import { createTenantRuntime, type TenantRuntime } from "./runtime";
import { setJobPrelude, setJobTenantLister } from "./scheduler";
import { shadowMiddleware } from "./shadow";
import { configureHealthChecks } from "../health";
import { getTenantDatabase } from "../dbRegistry";
import { sql } from "drizzle-orm";
import { bindTenantMiddleware, resolveTenantMiddleware } from "./tenantMiddleware";
import { centralLoginHost, createCentralAuthRouter, tenantUserFinder } from "../centralAuth";
import { runWithTenant } from "../tenant";
import { passwordFingerprint } from "../../localAuth";
import { requestPasswordReset } from "../../passwordReset";

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
    // Acceso centralizado (p. ej. app.bigelephant.es): su host no es de ninguna empresa, se atiende antes de resolverla
    const central = centralLoginHost(env);
    if (central) {
      const reader = rt.reader;
      app.use(
        createCentralAuthRouter({
          host: central,
          listTenants: () => reader.listTenants(),
          listDomains: (id) => reader.listDomains(id),
          findUser: tenantUserFinder(getTenantDatabase),
          passwordFingerprint,
          // Recuperación con el flujo, la URL y el remitente de cada empresa (en su contexto)
          requestReset: (id, email) =>
            runWithTenant(id, async () => {
              await Promise.all([warmConfigCache(), warmIntegrationCreds(), warmTenantIdentity()]);
              await requestPasswordReset(email);
            }),
        }),
      );
      console.log(JSON.stringify({ ctx: "CentralAuth", event: "enabled", host: central }));
    }
    app.use(resolveTenantMiddleware(rt.resolver));
    // Salud (/readyz): BD del registro y, si el host es de una empresa servible, la BD de esa empresa
    const runtime = rt;
    configureHealthChecks({
      registryPing: () => runtime.ping(),
      tenantPing: async (req) => {
        const r = await runtime.resolver.resolveHost(req.headers.host);
        if (r.kind !== "resolved" || (!r.tenant.policy.admin && !r.tenant.policy.publicWeb)) return null;
        const tenantId = r.tenant.tenantId;
        return async () => {
          const db = await getTenantDatabase(tenantId);
          if (!db) throw new Error("sin conexión");
          await db.execute(sql`SELECT 1`);
        };
      },
    });
    // Las tareas programadas recorren los tenants con escrituras del registro
    setJobTenantLister(writableTenantLister(rt.reader));
    // Las tareas también necesitan las credenciales del tenant en curso
    setJobPrelude(() => Promise.all([warmConfigCache(), warmIntegrationCreds(), warmTenantIdentity()]).then(() => undefined));
    // Marca, URL pública y entidad fiscal de cada empresa (registro, solo lectura)
    configureTenantIdentity(rt.identity);
    // Las licencias de módulos se leen del registro (solo lectura)
    configureModuleAccess(rt.entitlements);
    // Licencias por capacidad (catálogo de Elephant Source); se aplican con CAPABILITY_ENFORCEMENT=on
    configureCapabilityAccess(rt.capabilities);
    // Límites contratados (usuarios, almacenamiento) y uso declarado (registro 0013)
    configureLimitAccess(rt.limits);
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
  // Precarga los ajustes y la identidad del tenant (lecturas síncronas: Redsys, remitente, URL pública…)
  app.use((_req, _res, next) => {
    Promise.all([warmConfigCache(), warmIntegrationCreds(), warmTenantIdentity()]).then(() => next(), () => next());
  });
  // Soporte: lectura impuesta en el borde y puerta de entrada
  app.use(supportReadOnlyGuard());
  app.use(createSupportRouter());
}
