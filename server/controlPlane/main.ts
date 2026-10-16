/**
 * Punto de entrada del servicio del plano de control (proceso SEPARADO del Core).
 *
 *   pnpm exec tsx server/controlPlane/main.ts
 *
 * Variables:
 *   CP_PORT                     puerto (defecto 4100)
 *   CP_TOKENS                   JSON [{ id, sha256, scopes[] }] (solo hashes)
 *   REGISTRY_ADMIN_DATABASE_URL BD del registro con usuario de ESCRITURA
 *   REGISTRY_KEYS / REGISTRY_ACTIVE_KEY_ID   claves de cifrado de DSN
 *   CP_PLATFORM_TARGET          host CNAME de la plataforma (verificación de dominios)
 *   ERM_DATABASE_URL            (opcional) métricas de uso
 *   PROVISIONING_DB_ADMIN_URL   (opcional) servidor MySQL para crear BD de tenants
 *   BILLING_DATABASE_URL        (opcional) BD comercial
 *
 * Sin CP_TOKENS válidos el servicio NO arranca (nunca queda abierto).
 */
import path from "node:path";
import mysql from "mysql2/promise";
import { EntitlementAdmin } from "../_core/modules/mysqlEntitlements";
import { QuotaAdmin } from "../_core/erm/mysqlQuotas";
import { parseDefaultQuotas } from "../_core/erm/quota";
import { MysqlUsageStore } from "../_core/erm/usage";
import { keyringFromEnv } from "../_core/tenantRegistry/crypto";
import { MysqlTenantRegistryStore } from "../_core/tenantRegistry/mysqlStore";
import { TenantRegistryService } from "../_core/tenantRegistry/service";
import { ProvisioningService } from "../_core/provisioning/service";
import {
  MysqlDatabaseProvisioner,
  MysqlProvisioningStore,
  MysqlSchemaApplier,
  MysqlTenantSeeder,
} from "../_core/provisioning/mysqlAdapters";
import { SupportAdmin } from "../_core/support/grants";
import { MysqlWebStore } from "../web/store";
import { MysqlSubscriptionStore } from "../subscriptions/store";
import { MysqlCapabilityStore } from "../_core/capabilities/store";
import { MysqlTrialStore } from "../trials/store";
import { trialNotifierFromEnv } from "../trials/emailNotifier";
import type { TrialNotifier } from "../trials/onboarding";
import { MysqlOrganizationStore } from "../organization/service";
import { MysqlCrmStore } from "../crm/mysqlStore";
import { CrmService } from "../crm/service";
import { createContractActivation } from "../crm/activation";
import { createControlPlaneApp } from "./api";
import { parseTokens } from "./auth";
import fs from "node:fs";
import { MysqlBillingStore } from "../_core/billing/mysqlStore";
import { SubscriptionService } from "../_core/billing/service";
import { createPaymentProvider } from "../_core/billing/providers";
import { RegistryTenantEffects } from "../_core/billing/effects";
import { IncidentService, MysqlIncidentStore, webhookNotifier } from "../_core/ops/incidents";
import { MysqlTicketStore, TicketService } from "../_core/support/tickets";
import { runAlerts } from "../_core/ops/alerts";
import { SsoService, parseSsoUsers } from "./sso";
import { createRemoteJWKSet } from "jose";
import { operatorAuthFromEnv } from "./operatorSetup";

async function main() {
  const tokens = parseTokens(process.env.CP_TOKENS);
  if (tokens.length === 0) throw new Error("CP_TOKENS vacío o no válido: el plano de control no arranca sin tokens");
  const regUrl = process.env.REGISTRY_ADMIN_DATABASE_URL;
  if (!regUrl) throw new Error("Falta REGISTRY_ADMIN_DATABASE_URL");

  const pool = mysql.createPool({ uri: regUrl, connectionLimit: 5 });
  const store = new MysqlTenantRegistryStore(pool);
  const ring = keyringFromEnv(process.env);
  const registry = new TenantRegistryService(store, () => ring);
  const entitlements = new EntitlementAdmin(pool);
  const quotas = new QuotaAdmin(pool);

  let provisioning: ProvisioningService | undefined;
  if (process.env.PROVISIONING_DB_ADMIN_URL) {
    const adminUrl = new URL(process.env.PROVISIONING_DB_ADMIN_URL);
    const adminPool = mysql.createPool({ uri: process.env.PROVISIONING_DB_ADMIN_URL, connectionLimit: 2 });
    provisioning = new ProvisioningService({
      registry,
      reader: store,
      databases: new MysqlDatabaseProvisioner(adminPool, {
        host: process.env.PROVISIONING_DB_HOST ?? adminUrl.hostname,
        port: Number(process.env.PROVISIONING_DB_PORT ?? (adminUrl.port || 3306)),
        alias: process.env.PROVISIONING_DB_ALIAS,
      }),
      schema: new MysqlSchemaApplier({
        baselinePath: path.resolve(process.cwd(), "db/baseline/0000_baseline.sql"),
        migrationsDir: path.resolve(process.cwd(), "db/migrations"),
      }),
      seeder: new MysqlTenantSeeder(),
      entitlements,
      quotas,
      store: new MysqlProvisioningStore(pool),
    });
  }

  const usage = process.env.ERM_DATABASE_URL
    ? new MysqlUsageStore(mysql.createPool({ uri: process.env.ERM_DATABASE_URL, connectionLimit: 2 }))
    : undefined;

  // Facturación: requiere BD comercial y catálogo; los cobros siguen apagados salvo
  // BILLING_PROVIDER + BILLING_CHARGES_ENABLED=true (ver server/_core/billing/providers.ts).
  let billing: SubscriptionService | undefined;
  let billingStore: MysqlBillingStore | undefined;
  if (process.env.BILLING_DATABASE_URL && process.env.BILLING_CATALOG_FILE) {
    billingStore = new MysqlBillingStore(mysql.createPool({ uri: process.env.BILLING_DATABASE_URL, connectionLimit: 3 }));
    const cfg = createPaymentProvider(process.env);
    billing = new SubscriptionService({
      catalog: JSON.parse(fs.readFileSync(process.env.BILLING_CATALOG_FILE, "utf8")),
      store: billingStore,
      provider: cfg.provider,
      chargesEnabled: cfg.chargesEnabled,
      effects: new RegistryTenantEffects(registry, store, entitlements, quotas),
    });
    console.log(JSON.stringify({ ctx: "Billing", provider: cfg.kind, chargesEnabled: cfg.chargesEnabled }));
  }
  let sso: SsoService | undefined;
  if (process.env.CP_OIDC_ISSUER && process.env.CP_OIDC_CLIENT_ID && process.env.CP_OIDC_JWKS_URL && process.env.CP_SESSION_SECRET) {
    sso = new SsoService({
      issuer: process.env.CP_OIDC_ISSUER,
      clientId: process.env.CP_OIDC_CLIENT_ID,
      sessionSecret: process.env.CP_SESSION_SECRET,
      users: parseSsoUsers(process.env.CP_OIDC_USERS),
      getKey: createRemoteJWKSet(new URL(process.env.CP_OIDC_JWKS_URL)),
    });
  }
  const incidents = new IncidentService(
    new MysqlIncidentStore(pool),
    process.env.CP_ALERT_WEBHOOK ? webhookNotifier(process.env.CP_ALERT_WEBHOOK) : undefined,
  );
  const evaluate = () => runAlerts({ reader: store, incidents, usage, quotas, entitlements });
  if (process.env.CP_ALERTS_EVERY_SECONDS) {
    const every = Math.max(30, Number(process.env.CP_ALERTS_EVERY_SECONDS)) * 1000;
    // Un fallo de la evaluación no puede pasar desapercibido: la monitorización quedaría muerta
    const t = setInterval(() => void evaluate().catch((e) => console.error(JSON.stringify({ ctx: "Alerts", event: "evaluate_failed", error: e instanceof Error ? e.name : "error" }))), every);
    t.unref?.();
  }
  let crm: { service: CrmService; store: MysqlCrmStore } | undefined;
  if (process.env.CRM_DATABASE_URL) {
    const store = new MysqlCrmStore(mysql.createPool({ uri: process.env.CRM_DATABASE_URL, connectionLimit: 4 }));
    const activation =
      provisioning && process.env.CP_PLATFORM_DOMAIN
        ? createContractActivation({ provisioning, platformDomain: process.env.CP_PLATFORM_DOMAIN, actor: { type: "crm", id: "crm-contracts" } })
        : undefined;
    crm = { service: new CrmService({ store, activation }), store };
  }

  // Operadores humanos (usuario y contraseña): solo si la migración 0007 está aplicada
  const operators = await operatorAuthFromEnv(pool, process.env);
  console.log(JSON.stringify({ ctx: "OperatorAuth", enabled: !!operators.service, ...(operators.reason ? { reason: operators.reason } : {}), passwordReset: !!operators.service?.resetAvailable }));

  // Web comercial (catálogo y contenidos): misma BD del CRM; solo si la migración 0004 está aplicada
  let web: { store: MysqlWebStore; onPublish?: (version: string) => void } | undefined;
  if (process.env.CRM_DATABASE_URL) {
    const webPool = mysql.createPool({ uri: process.env.CRM_DATABASE_URL, connectionLimit: 3 });
    const ready = await webPool.query("SELECT 1 FROM web_entries LIMIT 0").then(() => true, () => false);
    const hook = process.env.CP_WEB_PUBLISH_HOOK ?? "";
    // Solo https, o http a la propia máquina (desarrollo local)
    const hookOk = /^https:\/\//.test(hook) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(hook);
    if (ready) {
      web = {
        store: new MysqlWebStore(webPool),
        // Aviso de publicación (p. ej. hook de regeneración de la web); nunca bloquea ni deshace nada
        onPublish: hookOk
          ? (version) =>
              void fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }), signal: AbortSignal.timeout(5000) }).catch(() => undefined)
          : undefined,
      };
    } else await webPool.end();
    console.log(JSON.stringify({ ctx: "WebAdmin", enabled: ready, ...(ready ? { publishHook: hookOk } : { reason: "migration_0004_missing" }) }));
  }

  // Licencias por capacidad (registro): solo si la migración 0008 del registro está aplicada
  const capabilitiesReady = await pool.query("SELECT 1 FROM tenant_capabilities LIMIT 0").then(() => true, () => false);
  const capabilities = capabilitiesReady ? new MysqlCapabilityStore(pool) : undefined;
  console.log(JSON.stringify({ ctx: "Capabilities", enabled: capabilitiesReady, ...(capabilitiesReady ? {} : { reason: "registry_migration_0008_missing" }) }));
  // Sedes y entidades fiscales: solo si la migración 0009 del registro está aplicada
  const organizationReady = await pool.query("SELECT 1 FROM tenant_sites LIMIT 0").then(() => true, () => false);
  const organization = organizationReady ? new MysqlOrganizationStore(pool) : undefined;
  console.log(JSON.stringify({ ctx: "Organization", enabled: organizationReady, ...(organizationReady ? {} : { reason: "registry_migration_0009_missing" }) }));

  // Suscripciones en modo sombra: misma BD del CRM; solo si la migración 0006 está aplicada
  let subscriptions: { store: MysqlSubscriptionStore } | undefined;
  if (process.env.CRM_DATABASE_URL && web) {
    const subsPool = mysql.createPool({ uri: process.env.CRM_DATABASE_URL, connectionLimit: 4 });
    const ready = await subsPool.query("SELECT 1 FROM subscriptions LIMIT 0").then(() => true, () => false);
    if (ready) subscriptions = { store: new MysqlSubscriptionStore(subsPool) };
    else await subsPool.end();
    console.log(JSON.stringify({ ctx: "Subscriptions", enabled: ready, mode: "shadow", ...(ready ? {} : { reason: "migration_0006_missing" }) }));
  }

  // Prueba gratuita de Essential: misma BD del CRM; solo si la migración 0007 está aplicada. Las rutas
  // públicas y la activación automática solo con CP_PUBLIC_TRIAL_ENABLED=1 / CP_TRIAL_AUTO_PROVISION=1.
  // No se envía ningún correo salvo con CP_TRIAL_EMAIL_MODE=sandbox|live y SMTP configurado; por defecto el
  // aviso solo deja constancia sin datos personales.
  let trials: { store: MysqlTrialStore; publicEnabled: boolean; autoProvision: boolean; notify?: TrialNotifier } | undefined;
  if (process.env.CRM_DATABASE_URL && subscriptions) {
    const trialPool = mysql.createPool({ uri: process.env.CRM_DATABASE_URL, connectionLimit: 3 });
    const ready = await trialPool.query("SELECT 1 FROM trial_requests LIMIT 0").then(() => true, () => false);
    const email = ready ? trialNotifierFromEnv(process.env) : null;
    if (ready) trials = { store: new MysqlTrialStore(trialPool), publicEnabled: process.env.CP_PUBLIC_TRIAL_ENABLED === "1", autoProvision: process.env.CP_TRIAL_AUTO_PROVISION === "1", notify: email?.notifier };
    else await trialPool.end();
    console.log(JSON.stringify({ ctx: "Trials", enabled: ready, publicEnabled: trials?.publicEnabled ?? false, autoProvision: trials?.autoProvision ?? false, email: { mode: email?.mode ?? "off", provider: email?.provider ?? null, ...(email?.reason ? { reason: email.reason } : {}) }, ...(ready ? {} : { reason: "migration_0007_missing" }) }));
  }

  // API pública de captación de la web comercial: solo con CRM, orígenes explícitos y secreto propio
  const publicOrigins = (process.env.CP_PUBLIC_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const publicSecret = process.env.CP_PUBLIC_FORM_SECRET ?? "";
  const publicReason = !crm ? "crm_not_configured" : !publicOrigins.length ? "no_origins" : publicSecret.length < 32 ? "secret_missing_or_short" : null;
  const publicIntake = publicReason ? undefined : { origins: publicOrigins, secret: publicSecret };
  console.log(JSON.stringify({ ctx: "PublicIntake", enabled: !!publicIntake, ...(publicReason ? { reason: publicReason } : { origins: publicOrigins }) }));

  const tickets = new TicketService(new MysqlTicketStore(pool), async (id) => (await store.getTenant(id)) !== null);

  const app = createControlPlaneApp({
    tickets,
    billing,
    billingStore,
    ops: { incidents, runAlerts: evaluate },
    sso,
    crm,
    tokens,
    registry,
    reader: store,
    entitlements,
    quotas,
    provisioning,
    usage,
    quotaDefaults: parseDefaultQuotas(process.env.ERM_DEFAULT_QUOTAS) ?? undefined,
    platformTarget: process.env.CP_PLATFORM_TARGET ?? "",
    platformDomain: process.env.CP_PLATFORM_DOMAIN || undefined,
    support: new SupportAdmin(pool),
    allowedOrigins: (process.env.CP_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    supportSecret: process.env.SUPPORT_JWT_SECRET && process.env.SUPPORT_JWT_SECRET.length >= 32 ? process.env.SUPPORT_JWT_SECRET : undefined,
    operators: operators.service,
    cookieSecure: operators.cookieSecure,
    trustProxy: process.env.CP_TRUST_PROXY ? Number(process.env.CP_TRUST_PROXY) || process.env.CP_TRUST_PROXY : undefined,
    publicIntake,
    web,
    subscriptions,
    capabilities,
    trials,
    organization,
  });

  const port = Number(process.env.CP_PORT ?? 4100);
  app.listen(port, () => console.log(JSON.stringify({ ctx: "ControlPlane", event: "listening", port })));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "error");
  process.exit(1);
});
