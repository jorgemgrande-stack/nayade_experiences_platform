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
 *   PROVISIONING_DB_SERVERS     (opcional) varios servidores MySQL (ver server/_core/provisioning/servers.ts)
 *   BACKUP_MAX_AGE_HOURS        (opcional) antigüedad máxima de la última copia antes de alertar (36)
 *   BILLING_DATABASE_URL        (opcional) BD comercial
 *
 * Sin CP_TOKENS válidos el servicio NO arranca (nunca queda abierto).
 */
import path from "node:path";
import mysql from "mysql2/promise";
import { EntitlementAdmin } from "../_core/modules/mysqlEntitlements";
import { QuotaAdmin } from "../_core/erm/mysqlQuotas";
import { DEFAULT_QUOTAS, parseDefaultQuotas } from "../_core/erm/quota";
import { crmContactOf, runUsageNotices } from "../commerce/usageNotices";
import { choosePublicDomain } from "../_core/tenantIdentity";
import { MysqlUsageStore } from "../_core/erm/usage";
import { costModelFromEnv } from "../_core/erm/costs";
import { MysqlCostModelStore } from "../_core/erm/costModelStore";
import { keyringFromEnv } from "../_core/tenantRegistry/crypto";
import { MysqlTenantRegistryStore } from "../_core/tenantRegistry/mysqlStore";
import { TenantRegistryService } from "../_core/tenantRegistry/service";
import { platformDomainsFromEnv } from "../_core/tenantRegistry/platformDomains";
import { ProvisioningService } from "../_core/provisioning/service";
import { MysqlProvisioningStore, MysqlSchemaApplier, MysqlTenantSeeder } from "../_core/provisioning/mysqlAdapters";
import { DatabaseServers, MultiServerDatabaseProvisioner, parseDatabaseServers, registryServerUsage } from "../_core/provisioning/servers";
import { MysqlBackupInventory } from "../_core/ops/backupInventory";
import { MysqlBackupCopyLedger } from "../_core/ops/backupCopies";
import { SupportAdmin } from "../_core/support/grants";
import { MysqlWebStore } from "../web/store";
import { MysqlSubscriptionStore } from "../subscriptions/store";
import { MysqlCapabilityStore } from "../_core/capabilities/store";
import { MysqlTenantLimitStore } from "../_core/limits/store";
import { MysqlTrialStore } from "../trials/store";
import { MysqlCommercialEventLog, commercialEventsProblem } from "../commercialEvents/log";
import { trialNotifierFromEnv } from "../trials/emailNotifier";
import { TrialScheduler, mysqlAdvisoryLock, startTrialScheduler } from "../trials/scheduler";
import { lifecyclePolicyFromEnv } from "../lifecycle/policy";
import { blockedDomainsFromEnv } from "../trials/service";
import type { TrialNotifier } from "../trials/onboarding";
import { platformMailFromEnv, tenantLaneResolver } from "../mail/platform";
import { SandboxAccess } from "../mail/sandboxAccess";
import { MysqlMailStore } from "../mail/store";
import { scopeAllows } from "../mail/policy";
import { brevoDiagnostics, mailProviderConfig } from "../mail/providers";
import { MysqlOrganizationStore } from "../organization/service";
import { MysqlOrderStore } from "../orchestrator/store";
import { testPaymentsFromEnv, type TestPaymentPort } from "../orchestrator/payments";
import { checkoutBlockedReason, describeStripeConfig, liveStartupProblem, stripeConfigFromEnv } from "../stripe/config";
import { stripeGateway, stripeWebhookVerifier } from "../stripe/gateway";
import { MysqlStripeStore } from "../stripe/store";
import { MysqlSubscriptionChangeStore } from "../stripe/changes";
import { MysqlExternalStore } from "../external/store";
import { MysqlInvoicingStore } from "../invoicing/store";
import { MysqlChargeStore } from "../invoicing/charges";
import { MysqlChargePaymentStore } from "../invoicing/chargePayments";
import { crmPublicOrigin } from "../external/urls";
import type { ExternalUrls } from "../external/service";
import { internalTenantsFromEnv } from "../stripe/purchases";
import { MysqlInvoiceLineStore } from "../stripe/invoiceLines";
import { notificationsFromEnv } from "../notifications/config";
import { liveOrdersProblem, liveSchemaProblem } from "../stripe/liveReadiness";
import { consumerWithdrawalFromEnv, fiscalScenariosFromEnv, taxExpectationsFromEnv } from "../stripe/buyerProfile";
import { consumerRatesFromEnv, eligibilitySummary, scenarioCountriesFromEnv } from "../stripe/eligibility";
import { viesClient, viesMaxAgeDaysFromEnv } from "../stripe/vies";
import { MysqlWithdrawalStore } from "../withdrawals/store";
import { checkoutUrlsFromEnv } from "../stripe/checkout";
import { MysqlCrmStore } from "../crm/mysqlStore";
import { CrmService } from "../crm/service";
import { createContractActivation } from "../crm/activation";
import { createControlPlaneApp } from "./api";
import { parseTokens } from "./auth";
import fs from "node:fs";
import { fixedPoolOptions } from "../_core/dbPoolConfig";
import { MysqlBillingStore } from "../_core/billing/mysqlStore";
import { SubscriptionService } from "../_core/billing/service";
import { createPaymentProvider } from "../_core/billing/providers";
import { RegistryTenantEffects } from "../_core/billing/effects";
import { IncidentService, MysqlIncidentStore, webhookNotifier, type IncidentNotifier } from "../_core/ops/incidents";
import { MysqlTicketStore, TicketService } from "../_core/support/tickets";
import { runAlerts } from "../_core/ops/alerts";
import { AlertScheduler } from "../_core/ops/alertScheduler";
import { FailureAlerts, configureFailureAlerts } from "../_core/ops/failureAlerts";
import { STRIPE_FAILURE_RULES } from "../stripe/alerts";
import { SsoService, parseSsoUsers } from "./sso";
import { createRemoteJWKSet } from "jose";
import { operatorAuthFromEnv } from "./operatorSetup";
import { DEFAULT_CORE_INTERNAL_URL, coreAccessClient } from "./tenantAccess";
import { outboxMfaNotice, outboxResetMailer, resetUnavailableReason } from "./operatorResetMail";
import { LeadNoticeService, MysqlSettingsStore, crmUrlFromEnv, settingsTablesReady } from "../crm/leadNotices";
import { AdminAlertService } from "../adminAlerts/service";
import { MysqlAdminAlertStore, adminAlertTablesReady } from "../adminAlerts/store";
import { CommercialEventWatcher, withExternalAlerts } from "../adminAlerts/sources";
import { startAlertCycle } from "../adminAlerts/runtime";
import { DeployWatcher, RestoreDrillWatcher, SERVED_STATUSES, UptimeMonitor, githubGet, isTestTenant } from "../adminAlerts/operations";
import { DataRequestService, dataRequestDeadlineAlerts } from "../dataRequests/service";
import { MysqlDataRequestStore, dataRequestTablesReady } from "../dataRequests/store";

async function main() {
  const tokens = parseTokens(process.env.CP_TOKENS);
  if (tokens.length === 0) throw new Error("CP_TOKENS vacío o no válido: el plano de control no arranca sin tokens");
  const regUrl = process.env.REGISTRY_ADMIN_DATABASE_URL;
  if (!regUrl) throw new Error("Falta REGISTRY_ADMIN_DATABASE_URL");

  // Tamaños de los pools fijos configurables por entorno (ver docs/runbooks/OPERACIONES_MULTITENANT.md)
  const pool = mysql.createPool({ uri: regUrl, ...fixedPoolOptions("CP_REGISTRY_POOL_CONNECTIONS", 5) });
  const store = new MysqlTenantRegistryStore(pool);
  const ring = keyringFromEnv(process.env);
  // Dominios de plataforma: CP_PLATFORM_DOMAINS (lista; el primero para las altas) o CP_PLATFORM_DOMAIN
  const platformDomains = platformDomainsFromEnv(process.env);
  const platformDomain = platformDomains[0];
  console.log(JSON.stringify({ ctx: "ControlPlane", event: "platform_domains", platformDomains, ...(platformDomains.length ? {} : { warning: "sin dominios de plataforma: platform_subdomain sin comprobar" }) }));
  const registry = new TenantRegistryService(store, () => ring, { platformDomains });
  const entitlements = new EntitlementAdmin(pool);
  const quotas = new QuotaAdmin(pool);

  let provisioning: ProvisioningService | undefined;
  // Uno o varios servidores MySQL (PROVISIONING_DB_SERVERS, o PROVISIONING_DB_ADMIN_URL como único servidor)
  const dbServers = parseDatabaseServers(process.env);
  if (dbServers) {
    const servers = new DatabaseServers(dbServers);
    console.log(JSON.stringify({ ctx: "Provisioning", servers: servers.aliases(), placement: dbServers.placement }));
    provisioning = new ProvisioningService({
      registry,
      reader: store,
      databases: new MultiServerDatabaseProvisioner(servers, { usage: () => registryServerUsage(pool) }),
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
    ? new MysqlUsageStore(mysql.createPool({ uri: process.env.ERM_DATABASE_URL, ...fixedPoolOptions("CP_ERM_POOL_CONNECTIONS", 2) }))
    : undefined;

  // Facturación: requiere BD comercial y catálogo; los cobros siguen apagados salvo
  // BILLING_PROVIDER + BILLING_CHARGES_ENABLED=true (ver server/_core/billing/providers.ts).
  let billing: SubscriptionService | undefined;
  let billingStore: MysqlBillingStore | undefined;
  if (process.env.BILLING_DATABASE_URL && process.env.BILLING_CATALOG_FILE) {
    billingStore = new MysqlBillingStore(mysql.createPool({ uri: process.env.BILLING_DATABASE_URL, ...fixedPoolOptions("CP_BILLING_POOL_CONNECTIONS", 3) }));
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
  // Avisos de incidencias: webhook (CP_ALERT_WEBHOOK) y, cuando el correo de plataforma está listo, correo al equipo
  // (CP_ALERT_EMAIL). Uno que falle no impide los demás
  const alertNotifiers: IncidentNotifier[] = process.env.CP_ALERT_WEBHOOK ? [webhookNotifier(process.env.CP_ALERT_WEBHOOK)] : [];
  const incidents = new IncidentService(new MysqlIncidentStore(pool), {
    notify: async (i, event) => {
      for (const n of alertNotifiers) await n.notify(i, event).catch(() => undefined);
    },
  });
  // Alertas por repetición de fallos (altas, correo, contratación): incidencias deduplicadas `rate:*`
  configureFailureAlerts(new FailureAlerts({ incidents, rules: STRIPE_FAILURE_RULES }));
  // Inventario de copias (registro 0010): alimenta la alerta backup.stale y /cp/v1/backups
  const backupsReady = await pool.query("SELECT 1 FROM backup_inventory LIMIT 0").then(() => true, () => false);
  const backupInventory = backupsReady ? new MysqlBackupInventory(pool) : undefined;
  const maxAgeHours = Number(process.env.BACKUP_MAX_AGE_HOURS ?? 36);
  const backupMaxAgeMs = (Number.isFinite(maxAgeHours) && maxAgeHours >= 1 ? maxAgeHours : 36) * 3_600_000;
  // Estado por destino (registro 0011): alertas del destino secundario (solo si alguna vez se usó)
  const copiesLedger = new MysqlBackupCopyLedger(pool);
  const copiesReady = backupsReady && (await copiesLedger.ready());
  const secHours = Number(process.env.BACKUP_SECONDARY_MAX_AGE_HOURS ?? backupMaxAgeMs / 3_600_000);
  const secondaryMaxAgeMs = (Number.isFinite(secHours) && secHours >= 1 ? secHours : backupMaxAgeMs / 3_600_000) * 3_600_000;
  console.log(JSON.stringify({ ctx: "Backups", inventory: backupsReady, copies: copiesReady, maxAgeHours: backupMaxAgeMs / 3_600_000, ...(backupsReady ? {} : { reason: "registry_migration_0010_missing" }) }));
  const evaluate = () =>
    runAlerts({
      reader: store,
      incidents,
      usage,
      quotas,
      entitlements,
      lastBackupAt: backupInventory ? () => backupInventory.lastSuccess("tenant") : undefined,
      backupMaxAgeMs,
      secondaryBackups: copiesReady
        ? { lastSuccessAt: () => copiesLedger.lastSuccess("secondary", "tenant"), latestAttempts: () => copiesLedger.latestAttempts("secondary"), maxAgeMs: secondaryMaxAgeMs }
        : undefined,
    });
  // Una evaluación a la vez y su estado visible en el Control Center (GET /alerts/status)
  const alertScheduler = new AlertScheduler(evaluate, { log: (event, detail) => console.error(JSON.stringify({ ctx: "Alerts", event, ...detail })) });
  const alertsEvery = Number(process.env.CP_ALERTS_EVERY_SECONDS);
  if (Number.isFinite(alertsEvery) && alertsEvery > 0) alertScheduler.start(alertsEvery);
  console.log(JSON.stringify({ ctx: "Alerts", scheduled: alertScheduler.status().scheduled, everySeconds: alertScheduler.status().everySeconds }));
  // Un único pool para la BD del CRM (CRM, web, suscripciones, pruebas y pedidos) en lugar de cinco
  // pools fijos (17 conexiones): tamaño CP_CRM_POOL_CONNECTIONS, 8 por defecto.
  const crmPool = process.env.CRM_DATABASE_URL
    ? mysql.createPool({ uri: process.env.CRM_DATABASE_URL, ...fixedPoolOptions("CP_CRM_POOL_CONNECTIONS", 8) })
    : null;
  // Correo de plataforma (CRM 0011): MAIL_MODE off por defecto; sandbox solo a MAIL_SANDBOX_ALLOWLIST;
  // live solo con MAIL_LIVE_AUTHORIZED=1. Ver docs/runbooks/CORREO_BREVO.md.
  // Buzones y tipos internos del correo de PRUEBAS autorizados desde el CRM (ajuste mail_sandbox, CRM 0025): solo en sandbox
  const sandboxAccess = crmPool ? new SandboxAccess({ settings: new MysqlSettingsStore(crmPool), log: (event, data) => console.log(JSON.stringify({ ctx: "Mail", event, ...data })) }) : null;
  if (sandboxAccess) {
    await sandboxAccess.refresh();
    setInterval(() => void sandboxAccess.refresh(), 60_000).unref();
  }
  const platformMail = await platformMailFromEnv(crmPool, process.env, { sandboxAccess: sandboxAccess ? () => sandboxAccess.snapshot() : undefined });
  const mailPolicy = platformMail.policy;
  if (platformMail.mailer?.opsRecipients.length) alertNotifiers.push(platformMail.mailer.incidentNotifier());
  // Registro de eventos comerciales (CRM 0015): pedidos y pagos, pruebas, suscripciones y cargos de Stripe
  // escriben sus hechos en la misma transacción que su cambio de estado. Entorno = modo comercial
  // (CP_STRIPE_MODE=live → live; si no, test). Sin la migración, o con filas del otro entorno, no se monta y
  // todo funciona igual, sin registro.
  const commercialEnvironment = (process.env.CP_STRIPE_MODE ?? "").trim().toLowerCase() === "live" ? "live" : "test";
  let commercialEvents: MysqlCommercialEventLog | undefined;
  if (crmPool) {
    const problem = await commercialEventsProblem(crmPool, commercialEnvironment);
    if (!problem) commercialEvents = new MysqlCommercialEventLog(crmPool, commercialEnvironment);
    console.log(JSON.stringify({ ctx: "CommercialEvents", enabled: !!commercialEvents, environment: commercialEnvironment, ...(problem ? { reason: problem === "missing_table" ? "migration_0015_missing" : problem } : {}) }));
  }
  console.log(JSON.stringify({ ctx: "Mail", outbox: !!platformMail.mailer, mode: mailPolicy.mode, provider: mailProviderConfig(process.env).provider?.name ?? null, ...(mailProviderConfig(process.env).problem ? { providerProblem: mailProviderConfig(process.env).problem } : {}), sendingDomain: mailPolicy.sendingDomain, opsRecipients: platformMail.mailer?.opsRecipients.length ?? 0, webhook: (process.env.BREVO_WEBHOOK_TOKEN ?? "").length >= 32, postmarkWebhook: (process.env.POSTMARK_WEBHOOK_TOKEN ?? "").length >= 32, ...(mailPolicy.degradedReason ? { degradedReason: mailPolicy.degradedReason } : {}), ...(platformMail.reason ? { reason: platformMail.reason } : {}) }));
  if (platformMail.mailer) {
    const every = Math.max(30, Number(process.env.CP_MAIL_DRAIN_EVERY_SECONDS ?? 60) || 60) * 1000;
    const t = setInterval(() => void platformMail.mailer!.service.drain(50).catch(() => undefined), every);
    t.unref?.();
  }
  let crm: { service: CrmService; store: MysqlCrmStore } | undefined;
  if (crmPool) {
    const store = new MysqlCrmStore(crmPool);
    const activation =
      provisioning && platformDomain
        ? createContractActivation({ provisioning, platformDomain, actor: { type: "crm", id: "crm-contracts" }, notifyWelcome: platformMail.mailer?.assistedWelcome() })
        : undefined;
    crm = { service: new CrmService({ store, activation }), store };
  }

  // Avisos de consumo a cada empresa (80 % / 100 % de un límite de su plan), con el mismo ritmo que las alertas
  if (usage && crm && platformMail.mailer && process.env.CP_ALERTS_EVERY_SECONDS) {
    const crmStore = crm.store;
    const notify = platformMail.mailer.usageNotifier();
    const defaults = parseDefaultQuotas(process.env.ERM_DEFAULT_QUOTAS) ?? DEFAULT_QUOTAS;
    const every = Math.max(60, Number(process.env.CP_ALERTS_EVERY_SECONDS)) * 1000;
    const t = setInterval(
      () =>
        void runUsageNotices({
          reader: store,
          quotas,
          usage,
          defaults,
          recipientOf: (id) => crmContactOf(crmStore, id),
          hostOf: async (id) => choosePublicDomain(await store.listDomains(id))?.domain ?? null,
          notify,
        }).catch((e) => console.error(JSON.stringify({ ctx: "UsageNotices", event: "run_failed", error: e instanceof Error ? e.name : "error" }))),
      every,
    );
    t.unref?.();
  }

  // Operadores humanos (usuario y contraseña): solo si la migración 0007 está aplicada
  // (segundo factor TOTP con la migración 0012; el secreto se cifra con el llavero del registro)
  // Restablecimiento de operadores: sin SMTP propio, por la bandeja de la plataforma (Brevo, dominio corporativo),
  // solo si el correo no está apagado (con MAIL_MODE=off no se ofrece en vez de fingir un envío)
  // Tampoco si el ámbito del correo lo deja fuera (p. ej. production solo con los avisos de solicitudes)
  const operatorResetMailer = platformMail.mailer && mailPolicy.mode !== "off" && scopeAllows(mailPolicy, "platform", "password_reset") ? outboxResetMailer(platformMail.mailer) : undefined;
  // Aviso de seguridad al operador al activar o retirar su segundo factor (si el ámbito del correo lo permite)
  const operatorMfaNotice = platformMail.mailer && mailPolicy.mode !== "off" && scopeAllows(mailPolicy, "platform", "security_notice") ? outboxMfaNotice(platformMail.mailer) : undefined;
  const operators = await operatorAuthFromEnv(pool, process.env, { keyring: ring, resetMailer: operatorResetMailer, securityNotice: operatorMfaNotice });
  // Avisos internos de solicitudes web (CRM 0025): destinatarios elegidos en el CRM entre los operadores; salen por la
  // bandeja de la plataforma con su política (modo, destinatarios autorizados, ámbito). Sin migración, no se monta.
  let leadNotices: LeadNoticeService | null = null;
  if (crm && crmPool && operators.service && (await settingsTablesReady(crmPool))) {
    const ops = operators.service;
    leadNotices = new LeadNoticeService({
      settings: new MysqlSettingsStore(crmPool),
      store: crm.store,
      crm: crm.service,
      mailer: platformMail.mailer,
      ledger: platformMail.mailer ? new MysqlMailStore(crmPool) : null,
      operators: async () => (await ops.list()).map((o) => ({ id: o.id, email: o.email, displayName: o.displayName, role: o.role, status: o.status })),
      crmUrl: crmUrlFromEnv(process.env),
      killSwitch: (process.env.CP_LEAD_NOTICES ?? "").trim().toLowerCase() === "off",
    });
    const every = Math.max(60, Number(process.env.CP_LEAD_NOTICES_SWEEP_SECONDS ?? 300) || 300) * 1000;
    const t = setInterval(() => void leadNotices!.sweep().catch(() => undefined), every);
    t.unref?.();
  }
  console.log(JSON.stringify({ ctx: "LeadNotices", mounted: !!leadNotices, ...(leadNotices ? leadNotices.status() : { reason: !crm ? "crm_not_configured" : "migration_0025_missing_or_no_operators" }), crmLink: !!crmUrlFromEnv(process.env) }));
  console.log(JSON.stringify({ ctx: "OperatorAuth", enabled: !!operators.service, ...(operators.reason ? { reason: operators.reason } : {}), passwordReset: !!operators.service?.resetAvailable, resetTransport: operators.resetTransport ?? null, ...(operators.service && !operators.service.resetAvailable ? { resetUnavailable: resetUnavailableReason({ resetUrl: process.env.CP_RESET_URL, smtp: !!(process.env.CP_RESET_SMTP_URL && process.env.CP_RESET_FROM), mailer: !!platformMail.mailer, policy: mailPolicy }) } : {}), mfa: operators.mfa ?? null }));

  // Web comercial (catálogo y contenidos): misma BD del CRM; solo si la migración 0004 está aplicada
  let web: { store: MysqlWebStore; onPublish?: (version: string) => void } | undefined;
  if (crmPool) {
    const webPool = crmPool;
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
    }
    console.log(JSON.stringify({ ctx: "WebAdmin", enabled: ready, ...(ready ? { publishHook: hookOk } : { reason: "migration_0004_missing" }) }));
  }

  // Licencias por capacidad (registro): solo si la migración 0008 del registro está aplicada
  const capabilitiesReady = await pool.query("SELECT 1 FROM tenant_capabilities LIMIT 0").then(() => true, () => false);
  const capabilities = capabilitiesReady ? new MysqlCapabilityStore(pool) : undefined;
  console.log(JSON.stringify({ ctx: "Capabilities", enabled: capabilitiesReady, ...(capabilitiesReady ? {} : { reason: "registry_migration_0008_missing" }) }));
  // Límites contratados y uso declarado (registro 0013): sin la migración, las licencias solo aplican capacidades
  const limitsReady = await pool.query("SELECT 1 FROM tenant_entitlement_limits LIMIT 0").then(() => true, () => false);
  const limits = limitsReady ? new MysqlTenantLimitStore(pool) : undefined;
  console.log(JSON.stringify({ ctx: "Limits", enabled: limitsReady, ...(limitsReady ? {} : { reason: "registry_migration_0013_missing" }) }));
  // Tarifas del Resource Manager editables (registro 0014): sin la migración, solo las del entorno o la estimación
  const costRatesReady = await pool.query("SELECT 1 FROM erm_cost_model LIMIT 0").then(() => true, () => false);
  const costModelStore = costRatesReady ? new MysqlCostModelStore(pool) : undefined;
  console.log(JSON.stringify({ ctx: "CostRates", editable: costRatesReady, ...(costRatesReady ? {} : { reason: "registry_migration_0014_missing" }) }));
  // Sedes y entidades fiscales: solo si la migración 0009 del registro está aplicada
  const organizationReady = await pool.query("SELECT 1 FROM tenant_sites LIMIT 0").then(() => true, () => false);
  const organization = organizationReady ? new MysqlOrganizationStore(pool) : undefined;
  console.log(JSON.stringify({ ctx: "Organization", enabled: organizationReady, ...(organizationReady ? {} : { reason: "registry_migration_0009_missing" }) }));

  // Suscripciones en modo sombra: misma BD del CRM; solo si la migración 0006 está aplicada
  let subscriptions: { store: MysqlSubscriptionStore } | undefined;
  if (crmPool && web) {
    const subsPool = crmPool;
    const ready = await subsPool.query("SELECT 1 FROM subscriptions LIMIT 0").then(() => true, () => false);
    if (ready) subscriptions = { store: new MysqlSubscriptionStore(subsPool, commercialEvents) };
    console.log(JSON.stringify({ ctx: "Subscriptions", enabled: ready, mode: "shadow", ...(ready ? {} : { reason: "migration_0006_missing" }) }));
  }

  // Prueba gratuita de Essential: misma BD del CRM; solo si la migración 0007 está aplicada. Las rutas
  // públicas y la activación automática solo con CP_PUBLIC_TRIAL_ENABLED=1 / CP_TRIAL_AUTO_PROVISION=1.
  // No se envía ningún correo salvo con CP_TRIAL_EMAIL_MODE=sandbox|live y SMTP configurado; por defecto el
  // aviso solo deja constancia sin datos personales.
  let trials: { store: MysqlTrialStore; publicEnabled: boolean; autoProvision: boolean; notify?: TrialNotifier; blockedDomains: string[] } | undefined;
  if (crmPool && subscriptions) {
    const trialPool = crmPool;
    const ready = await trialPool.query("SELECT 1 FROM trial_requests LIMIT 0").then(() => true, () => false);
    // Con la bandeja de plataforma, los avisos de la prueba salen por ella; si no, el notificador SMTP propio
    const email = !ready ? null : platformMail.mailer ? { notifier: platformMail.mailer.trialNotifier(), mode: mailPolicy.mode, provider: "outbox", reason: undefined as string | undefined } : trialNotifierFromEnv(process.env);
    if (ready) trials = { store: new MysqlTrialStore(trialPool, commercialEvents), publicEnabled: process.env.CP_PUBLIC_TRIAL_ENABLED === "1", autoProvision: process.env.CP_TRIAL_AUTO_PROVISION === "1", notify: email?.notifier, blockedDomains: blockedDomainsFromEnv(process.env) };
    console.log(JSON.stringify({ ctx: "Trials", enabled: ready, publicEnabled: trials?.publicEnabled ?? false, autoProvision: trials?.autoProvision ?? false, email: { mode: email?.mode ?? "off", provider: email?.provider ?? null, ...(email?.reason ? { reason: email.reason } : {}) }, ...(ready ? {} : { reason: "migration_0007_missing" }) }));
    // Tarea programada de vencimiento y avisos: APAGADA salvo CP_TRIALS_SCHEDULER_ENABLED=1. Una sola réplica
    // trabaja en cada tick (GET_LOCK); nunca suspende, cancela ni borra. Sin notificador, los avisos solo se registran.
    if (trials) {
      const notify = trials.notify ?? { expiryNotice: async (_to: string, i: { trialId: number; daysLeft: number }) => void console.log(JSON.stringify({ ctx: "Trials", event: "expiry_notice_not_sent", trialId: i.trialId, daysLeft: i.daysLeft })) };
      startTrialScheduler({ scheduler: new TrialScheduler({ store: trials.store, notify, lock: mysqlAdvisoryLock(trialPool) }), env: process.env });
    }
  }

  // Stripe Billing: apagado sin CP_STRIPE_MODE (test o live); cualquier credencial del otro modo o
  // configuración insegura impide arrancar (server/stripe/config.ts). Requiere pedidos y la migración 0012.
  // En live, además: NODE_ENV=production (si no, no arranca), la migración 0013 completa (si no, no se
  // monta) y Checkout apagado mientras la política fiscal esté pendiente (CP_STRIPE_TAX_POLICY). La
  // configuración se lee ANTES de los pedidos: el modo del orquestador sale de ella.
  const stripeConfig = stripeConfigFromEnv(process.env);
  const liveProblem = liveStartupProblem(stripeConfig, process.env);
  if (liveProblem) throw new Error(liveProblem);

  // Orquestador comercial: APAGADO salvo CP_ORCHESTRATOR_ENABLED=1 y con la migración 0010 del CRM.
  // Pagos simulados solo de prueba (CP_PAYMENTS_PROVIDER=simulated + secreto); el cobro automático no existe.
  // En live, ni pedidos ni pagos si la BD trae datos del entorno de pruebas (pagos de prueba cobrados en
  // pedidos vivos o un prefijo de entorno guardado distinto), aunque Stripe no llegue a montarse.
  const ordersMode = stripeConfig?.mode ?? "test";
  let orders: { store: MysqlOrderStore; payments: TestPaymentPort | null; mode: typeof ordersMode } | undefined;
  if (process.env.CP_ORCHESTRATOR_ENABLED === "1" && crmPool && subscriptions && capabilities) {
    const payments = testPaymentsFromEnv(process.env);
    const ordersPool = crmPool;
    const ready = await ordersPool.query("SELECT 1 FROM commercial_orders LIMIT 0").then(() => true, () => false);
    const liveData = ready && stripeConfig?.mode === "live" ? await liveOrdersProblem(ordersPool, stripeConfig.namespace) : null;
    if (ready && !liveData) orders = { store: new MysqlOrderStore(ordersPool, commercialEvents), payments: payments.provider, mode: ordersMode };
    console.log(JSON.stringify({ ctx: "Orders", enabled: !!orders, mode: ordersMode, payments: { provider: payments.provider?.kind ?? null, mode: "test", autoCharge: false, ...(payments.reason ? { reason: payments.reason } : {}) }, ...(!ready ? { reason: "migration_0010_missing" } : liveData ? { reason: liveData } : {}) }));
  }
  // Motor de transiciones temporales: tarea APAGADA por defecto (CP_LIFECYCLE_SCHEDULER_ENABLED=1) y en modo
  // «plan» (solo calcula) salvo CP_LIFECYCLE_MODE=apply; en live, además CP_LIFECYCLE_LIVE_APPLY=1. Una sola
  // réplica trabaja en cada tick (GET_LOCK). Nunca borra datos ni convierte pruebas a pago.
  const lifecyclePolicy = lifecyclePolicyFromEnv(process.env);
  const lifecycle = orders && crmPool ? { policy: lifecyclePolicy, lock: mysqlAdvisoryLock(crmPool) } : undefined;
  console.log(JSON.stringify({ ctx: "Lifecycle", mounted: !!lifecycle, enabled: lifecyclePolicy.enabled, mode: lifecyclePolicy.mode, ...(lifecyclePolicy.modeReason ? { reason: lifecyclePolicy.modeReason } : {}), intervalMs: lifecyclePolicy.intervalMs }));

  // Escenarios fiscales aprobados y versiones de consentimiento. Un valor no admitido impide arrancar (nunca a medias)
  const fiscal = {
    scenarios: fiscalScenariosFromEnv(process.env),
    taxExpectations: taxExpectationsFromEnv(process.env),
    // Elegibilidad por país (CP_STRIPE_SCENARIO_COUNTRIES) y tipo decidido para mostrar el precio final a particulares
    // (CP_STRIPE_CONSUMER_RATES). Un valor no admitido impide arrancar
    countries: scenarioCountriesFromEnv(process.env),
    consumerRates: consumerRatesFromEnv(process.env),
    // URL de los textos legales publicados (para el Customer Portal); sin ellas, el plan del Portal las marca pendientes
    legalUrls: { terms: (process.env.CP_TERMS_URL ?? "").trim() || null, privacy: (process.env.CP_PRIVACY_URL ?? "").trim() || null },
    consent: {
      terms: (process.env.CP_TERMS_VERSION ?? "").trim() || null,
      privacy: (process.env.CP_PRIVACY_VERSION ?? "").trim() || null,
      precontract: (process.env.CP_PRECONTRACT_VERSION ?? "").trim() || null,
      withdrawal: consumerWithdrawalFromEnv(process.env),
    },
  };
  // Servicios de clientes externos (CRM 0026): solo con Stripe montado, sus tablas y un origen https del CRM
  let external: { store: MysqlExternalStore; urls: ExternalUrls; ipSalt?: string; liveEnabled?: boolean } | undefined;
  let stripe: { config: NonNullable<typeof stripeConfig>; store: MysqlStripeStore; gateway: ReturnType<typeof stripeGateway>; urls: ReturnType<typeof checkoutUrlsFromEnv>; checkoutEnabled: boolean; verifyWebhook: ReturnType<typeof stripeWebhookVerifier>; workerEnabled: boolean; publicStatus: boolean; selfService: boolean; termsVersion: string | null; fiscal: typeof fiscal; purchases?: { enabled: boolean; changes: MysqlSubscriptionChangeStore; internalTenants: ReadonlySet<string> }; invoiceLines?: MysqlInvoiceLineStore; vies?: { client: ReturnType<typeof viesClient>; maxAgeDays: number }; billingPortal?: { enabled: boolean; configurationId: string | null } } | undefined;
  if (stripeConfig) {
    const urls = checkoutUrlsFromEnv(process.env);
    // La bandera sigue apagada por defecto; en live sin política fiscal, Checkout queda apagado aunque esté a 1
    const checkoutBlocked = checkoutBlockedReason(stripeConfig);
    const checkoutEnabled = process.env.CP_STRIPE_CHECKOUT_ENABLED === "1" && !checkoutBlocked;
    const workerEnabled = process.env.CP_STRIPE_WORKER_ENABLED === "1";
    const publicStatus = process.env.CP_PUBLIC_CHECKOUT_ENABLED === "1";
    const selfService = process.env.CP_PUBLIC_SELF_SERVICE_ENABLED === "1";
    const termsVersion = (process.env.CP_TERMS_VERSION ?? "").trim() || null;
    // Sin proxy de confianza los límites por IP del webhook serían comunes a todo el tráfico
    const trustProxyOk = process.env.NODE_ENV !== "production" || !!process.env.CP_TRUST_PROXY;
    const migrated = trustProxyOk && !!orders && !!crmPool && (await crmPool.query("SELECT 1 FROM stripe_prices LIMIT 0").then(() => true, () => false));
    // En live, la BD debe admitir filas live (migración 0013 entera y registrada, sin migraciones a medias)
    const liveSchema = stripeConfig.mode === "live" && migrated ? await liveSchemaProblem(crmPool!).catch(() => "migration_0013_missing") : null;
    const liveMigrated = stripeConfig.mode !== "live" || (migrated && !liveSchema);
    // El prefijo del entorno no puede cambiar: los objetos ya creados en Stripe dejarían de reconocerse. Se fija POR MODO:
    // los objetos de pruebas y los live son de cuentas distintas, así que el prefijo de pruebas no ata al de live
    let namespaceOk = true;
    if (migrated && liveMigrated) {
      const st = new MysqlStripeStore(crmPool!, stripeConfig.mode);
      const stateKey = stripeConfig.mode === "live" ? "namespace:live" : "namespace";
      const saved = await st.getState(stateKey);
      if (!saved) await st.setState(stateKey, { namespace: stripeConfig.namespace }, Date.now());
      else namespaceOk = saved.namespace === stripeConfig.namespace;
      if (!namespaceOk) console.log(JSON.stringify({ ctx: "Stripe", event: "namespace_mismatch", mode: stripeConfig.mode, saved: saved?.namespace, configured: stripeConfig.namespace }));
    }
    const ready = migrated && liveMigrated && namespaceOk;
    // Compra de módulos (CRM 0018) y líneas de factura (CRM 0019): solo si la tabla existe; la compra, además,
    // con CP_COMMERCE_PURCHASES_ENABLED=1 (apagada por defecto). Sin las tablas, todo funciona como antes
    const hasTable = async (t: string) => (ready ? await crmPool!.query(`SELECT 1 FROM ${t} LIMIT 0`).then(() => true, () => false) : false);
    const changesReady = await hasTable("stripe_subscription_changes");
    const linesReady = await hasTable("stripe_invoice_lines");
    const purchasesEnabled = process.env.CP_COMMERCE_PURCHASES_ENABLED === "1";
    // Empresas de prueba que pueden comprar productos internos (vacío: ninguna). Un id no válido impide arrancar
    const internalTenants = internalTenantsFromEnv(process.env);
    if (ready)
      stripe = {
        config: stripeConfig,
        store: new MysqlStripeStore(crmPool!, stripeConfig.mode, commercialEvents),
        gateway: stripeGateway(stripeConfig),
        urls,
        checkoutEnabled,
        verifyWebhook: stripeWebhookVerifier(stripeConfig),
        workerEnabled,
        publicStatus,
        selfService,
        termsVersion,
        fiscal,
        // VIES (API REST de la Comisión Europea): verificación del NIF-IVA antes de la inversión del sujeto pasivo
        vies: { client: viesClient(), maxAgeDays: viesMaxAgeDaysFromEnv(process.env) },
        ...(changesReady ? { purchases: { enabled: purchasesEnabled, changes: new MysqlSubscriptionChangeStore(crmPool!, stripeConfig.mode), internalTenants } } : {}),
        // Portal de facturación (solo facturas y método de pago; apagado salvo CP_BILLING_PORTAL_ENABLED=1)
        billingPortal: {
          enabled: process.env.CP_BILLING_PORTAL_ENABLED === "1",
          configurationId: /^bpc_[A-Za-z0-9]{8,64}$/.test((process.env.CP_BILLING_PORTAL_CONFIGURATION ?? "").trim()) ? process.env.CP_BILLING_PORTAL_CONFIGURATION!.trim() : null,
        },
        ...(linesReady ? { invoiceLines: new MysqlInvoiceLineStore(crmPool!, stripeConfig.mode) } : {}),
      };
    const externalReady = (await hasTable("external_subscriptions")) && (await hasTable("crm_contract_acceptances")) && (await hasTable("external_subscription_events"));
    // La página pública de aceptación y las vueltas de Stripe van en el dominio del CRM (sirve /cp/v1)
    const crmOrigin = crmPublicOrigin(process.env);
    if (ready && externalReady && crmOrigin) {
      const pub = `${crmOrigin}/cp/v1/public/contract-acceptance`;
      external = { store: new MysqlExternalStore(crmPool!, stripeConfig.mode), urls: { acceptance: pub, setupSuccess: `${pub}/autorizado`, setupCancel: `${pub}/cancelado`, portalReturn: `${pub}/portal` }, ipSalt: (process.env.CP_PUBLIC_FORM_SECRET ?? "").trim() || undefined, liveEnabled: process.env.CP_EXTERNAL_LIVE_ENABLED === "1" };
    }
    console.log(JSON.stringify({ ctx: "External", mounted: !!external, liveCharges: !!external?.liveEnabled && stripeConfig.mode === "live", ...(ready && !externalReady ? { reason: "migration_0026_missing" } : ready && !crmOrigin ? { reason: "crm_origin_missing" } : {}) }));
    console.log(JSON.stringify({ ctx: "Commerce", purchases: { mounted: changesReady, enabled: changesReady && purchasesEnabled, internalTenants: internalTenants.size, ...(ready && !changesReady ? { reason: "migration_0018_missing" } : {}) }, invoiceLines: { mounted: linesReady, ...(ready && !linesReady ? { reason: "migration_0019_missing" } : {}) } }));
    console.log(
      JSON.stringify({
        ctx: "Stripe",
        ...describeStripeConfig(stripeConfig),
        mounted: ready,
        checkout: ready && checkoutEnabled && !!urls,
        ...(checkoutBlocked ? { checkoutReason: checkoutBlocked } : {}),
        worker: ready && workerEnabled,
        publicStatus: ready && publicStatus,
        selfService: ready && selfService,
        termsPublished: !!termsVersion,
        fiscalScenarios: Array.from(fiscal.scenarios),
        taxExpectations: Object.fromEntries(fiscal.taxExpectations),
        consumerWithdrawal: fiscal.consent.withdrawal,
        // Qué escenarios se pueden cobrar de verdad y en qué países (sin datos personales)
        eligibility: Object.fromEntries(Object.entries(eligibilitySummary({ ...fiscal, consent: fiscal.consent })).filter(([, v]) => v.approved)),
        consumerRates: Object.fromEntries(fiscal.consumerRates),
        ...(ready ? {} : { reason: !trustProxyOk ? "trust_proxy_missing" : !orders ? "orders_not_enabled" : !migrated ? "migration_0012_missing" : !liveMigrated ? (liveSchema ?? "migration_0013_missing") : "namespace_changed" }),
      }),
    );
  }
  // Sin Stripe en el entorno, los servicios externos también se montan: contrato, aceptación y seguimiento funcionan; la
  // autorización del método de pago y los cobros responden que Stripe no está configurado
  if (!stripe && crmPool && crm) {
    const pool = crmPool;
    const has = (t: string) => pool.query(`SELECT 1 FROM ${t} LIMIT 0`).then(() => true, () => false);
    const origin = crmPublicOrigin(process.env);
    const tables = (await has("external_subscriptions")) && (await has("crm_contract_acceptances")) && (await has("external_subscription_events"));
    if (tables && origin) {
      const pub = `${origin}/cp/v1/public/contract-acceptance`;
      external = { store: new MysqlExternalStore(pool, "test"), urls: { acceptance: pub, setupSuccess: `${pub}/autorizado`, setupCancel: `${pub}/cancelado`, portalReturn: `${pub}/portal` }, ipSalt: (process.env.CP_PUBLIC_FORM_SECRET ?? "").trim() || undefined, liveEnabled: false };
    }
    console.log(JSON.stringify({ ctx: "External", mounted: !!external, stripe: false, ...(!tables ? { reason: "migration_0026_missing" } : !origin ? { reason: "crm_origin_missing" } : {}) }));
  }

  // Facturación propia (CRM 0027): borradores por devengo; expedir solo con CP_INVOICING_ISSUE_ENABLED=1. Mismo entorno
  // (livemode) que los servicios externos cuyos cobros lee
  let invoicing: { store: MysqlInvoicingStore; issueEnabled: boolean; seriesCode: string; charges?: MysqlChargeStore; chargePayments?: MysqlChargePaymentStore } | undefined;
  if (crmPool && crm) {
    const pool = crmPool;
    const has = (t: string) => pool.query(`SELECT 1 FROM ${t} LIMIT 0`).then(() => true, () => false);
    const tables = (await has("invoices")) && (await has("invoice_lines")) && (await has("invoice_series"));
    const series = (process.env.CP_INVOICING_SERIES ?? "").trim().toUpperCase();
    if (tables) invoicing = { store: new MysqlInvoicingStore(pool, external?.store.mode ?? "test"), issueEnabled: process.env.CP_INVOICING_ISSUE_ENABLED === "1", seriesCode: /^[A-Z]{1,8}$/.test(series) ? series : "EB" };
    // Cargos extraordinarios y gastos variables (CRM 0028): solo con su tabla
    const chargesReady = !!invoicing && (await has("billing_charges"));
    if (invoicing && chargesReady) invoicing.charges = new MysqlChargeStore(pool, external?.store.mode ?? "test");
    // Cobro de los cargos (CRM 0029): solo con su tabla; sin ella los cargos se aprueban y facturan, pero no se cobran aquí
    const paymentsReady = chargesReady && (await has("billing_charge_payments"));
    if (invoicing && paymentsReady) invoicing.chargePayments = new MysqlChargePaymentStore(pool, external?.store.mode ?? "test");
    if (invoicing && chargesReady) console.log(JSON.stringify({ ctx: "Invoicing", chargePayments: paymentsReady, ...(paymentsReady ? {} : { reason: "migration_0029_missing" }) }));
    console.log(JSON.stringify({ ctx: "Invoicing", mounted: !!invoicing, ...(invoicing ? { issueEnabled: invoicing.issueEnabled, series: invoicing.seriesCode } : { reason: "migration_0027_missing" }) }));
    if (invoicing) console.log(JSON.stringify({ ctx: "Invoicing", charges: chargesReady, ...(chargesReady ? {} : { reason: "migration_0028_missing" }) }));
  }

  // API pública de captación de la web comercial: solo con CRM, orígenes explícitos y secreto propio
  const publicOrigins = (process.env.CP_PUBLIC_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const publicSecret = process.env.CP_PUBLIC_FORM_SECRET ?? "";
  const publicReason = !crm ? "crm_not_configured" : !publicOrigins.length ? "no_origins" : publicSecret.length < 32 ? "secret_missing_or_short" : null;
  const publicIntake = publicReason ? undefined : { origins: publicOrigins, secret: publicSecret };
  console.log(JSON.stringify({ ctx: "PublicIntake", enabled: !!publicIntake, ...(publicReason ? { reason: publicReason } : { origins: publicOrigins }) }));

  const tickets = new TicketService(new MysqlTicketStore(pool), async (id) => (await store.getTenant(id)) !== null, Date.now, platformMail.mailer?.ticketNotifier());

  // Desistimiento de consumidores (CRM 0022): solo con pedidos y la tabla; si no, la función no se monta
  let withdrawals: { store: MysqlWithdrawalStore } | undefined;
  if (orders && crmPool) {
    const ready = await crmPool.query("SELECT 1 FROM consumer_withdrawals LIMIT 0").then(() => true, () => false);
    if (ready) withdrawals = { store: new MysqlWithdrawalStore(crmPool, orders.mode) };
    console.log(JSON.stringify({ ctx: "Withdrawals", mounted: ready, receipts: !!platformMail.mailer && mailPolicy.mode !== "off", ...(ready ? {} : { reason: "migration_0022_missing" }) }));
  }

  // Alertas administrativas (familia D, CRM 0030 y ajustes 0025): avisos internos a la administración por hechos
  // confirmados. Sin las tablas no se monta y los avisos internos siguen como antes (CP_ALERT_EMAIL).
  let adminAlerts: AdminAlertService | null = null;
  // Solicitudes de derechos de protección de datos (RGPD, CRM 0034): registro desde el CRM con plazo legal de 30 días
  const dataRequests = crm && crmPool && (await dataRequestTablesReady(crmPool)) ? new DataRequestService({ store: new MysqlDataRequestStore(crmPool), raise: (id, f) => (adminAlerts ? adminAlerts.raise(id, f) : Promise.resolve(null)) }) : null;
  console.log(JSON.stringify({ ctx: "DataRequests", mounted: !!dataRequests, ...(dataRequests ? {} : { reason: !crm ? "crm_not_configured" : "migration_0034_missing" }) }));
  if (crm && crmPool && (await settingsTablesReady(crmPool))) {
    const alertPool = crmPool;
    const alertStore = new MysqlAdminAlertStore(alertPool);
    const crmStore = crm.store;
    const alerts = new AdminAlertService({
      store: alertStore,
      settings: new MysqlSettingsStore(alertPool),
      mailer: platformMail.mailer,
      envRecipients: platformMail.mailer?.opsRecipients ?? [],
      crmUrl: crmUrlFromEnv(process.env),
      environment: process.env.RAILWAY_ENVIRONMENT_NAME?.trim() || null,
      tablesReady: () => adminAlertTablesReady(alertPool),
    });
    await alerts.checkReady();
    adminAlerts = alerts;
    platformMail.mailer?.setAdminAlerts(alerts);
    // Las incidencias llegan también sin CP_ALERT_EMAIL (los destinatarios los decide el CRM; sin alertas activas, nada)
    if (platformMail.mailer && !platformMail.mailer.opsRecipients.length) alertNotifiers.push(platformMail.mailer.incidentNotifier());
    const raise = (id: string, f: Parameters<AdminAlertService["raise"]>[1]) => alerts.raise(id, f);
    const companyName = async (id: number) => ((await crmStore.get("companies", id)) as { name?: string } | null)?.name ?? null;
    if (external) external = { ...external, store: withExternalAlerts(external.store, { raise, companyName }) };
    const events = commercialEvents;
    const watcher = events
      ? new CommercialEventWatcher({
          events,
          store: alertStore,
          raise,
          latestId: async () => {
            const [r] = (await alertPool.query("SELECT COALESCE(MAX(id), 0) AS id FROM commercial_events WHERE environment = ?", [commercialEnvironment])) as unknown as [Array<{ id: number }>];
            return Number(r[0]?.id ?? 0);
          },
          context: async (e) => ({ company: e.companyId ? await companyName(e.companyId) : null, reference: e.orderId && orders ? ((await orders.store.get(e.orderId))?.reference ?? null) : null }),
        })
      : null;
    const ordersStore = orders?.store;
    const externalStore = external?.store;
    // Disponibilidad de cada empresa y publicación automática: por defecto solo en production (en live todas las empresas
    // son de prueba y las publicaciones las vigila production); CP_UPTIME_WATCH / CP_DEPLOY_WATCH = 1 o 0 lo fuerzan
    const isProduction = (process.env.RAILWAY_ENVIRONMENT_NAME ?? "").trim() === "production";
    const watch = (v: string | undefined) => v === "1" || (v !== "0" && isProduction);
    const uptime = watch(process.env.CP_UPTIME_WATCH)
      ? new UptimeMonitor({
          store: alertStore,
          raise,
          targets: async () => {
            const out = [];
            for (const t of await store.listTenants()) {
              if (!SERVED_STATUSES.includes(t.status) || isTestTenant(t.id, t.displayName)) continue;
              const domain = choosePublicDomain(await store.listDomains(t.id))?.domain;
              if (domain) out.push({ tenantId: t.id, company: t.displayName, url: `https://${domain}/readyz` });
            }
            return out;
          },
        })
      : null;
    const deploys = watch(process.env.CP_DEPLOY_WATCH) ? new DeployWatcher({ get: githubGet(), repo: "jorgemgrande-stack/nayade_experiences_platform", branch: "integration/elephant-source", store: alertStore, raise }) : null;
    console.log(JSON.stringify({ ctx: "AdminAlerts", uptimeWatch: !!uptime, deployWatch: !!deploys, restoreDrills: copiesReady }));
    const every = Math.max(60, Number(process.env.CP_ADMIN_ALERTS_EVERY_SECONDS ?? 120) || 120) * 1000;
    startAlertCycle(
      {
        alerts,
        watcher,
        pastDueOrders: ordersStore ? () => ordersStore.list({ states: ["past_due"], limit: 500 }) : undefined,
        pastDueExternals: externalStore ? () => externalStore.list({ status: "past_due" }) : undefined,
        openTickets: async () => Promise.all((await tickets.list({ status: "open", limit: 200 })).items.map(async (t) => ({ ticket: t, events: (await tickets.get(t.id)).events }))),
        operations: [
          ...(dataRequests ? [{ name: "dataRequests", run: async () => { const list = dataRequestDeadlineAlerts(await dataRequests.open(), Date.now()); for (const a of list) await alerts.raise(a.id, a.facts); return list.length; } }] : []),
          ...(copiesReady ? [{ name: "restoreDrills", run: () => new RestoreDrillWatcher({ restores: () => copiesLedger.listRestores(50), store: alertStore, raise }).tick() }] : []),
          ...(uptime ? [{ name: "uptime", run: async () => (await uptime.tick()).down }] : []),
          ...(deploys ? [{ name: "deploys", run: () => deploys.tick() }] : []),
        ],
      },
      every,
    );
  }
  console.log(JSON.stringify({ ctx: "AdminAlerts", mounted: !!adminAlerts, ...(adminAlerts ? adminAlerts.status() : { reason: !crm ? "crm_not_configured" : "migration_0025_missing" }), crmLink: !!crmUrlFromEnv(process.env) }));

  const app = createControlPlaneApp({
    tickets,
    billing,
    billingStore,
    ops: { incidents, runAlerts: () => alertScheduler.run(), alertStatus: () => alertScheduler.status() },
    backups: backupInventory ? { inventory: backupInventory, maxAgeMs: backupMaxAgeMs, copies: copiesReady ? copiesLedger : undefined, secondaryMaxAgeMs } : undefined,
    health: { registryPing: async () => void (await pool.query("SELECT 1")) },
    sso,
    crm,
    tokens,
    registry,
    reader: store,
    entitlements,
    quotas,
    provisioning,
    usage,
    costModel: costModelFromEnv(process.env),
    costModelStore,
    quotaDefaults: parseDefaultQuotas(process.env.ERM_DEFAULT_QUOTAS) ?? undefined,
    platformTarget: process.env.CP_PLATFORM_TARGET ?? "",
    platformDomain,
    support: new SupportAdmin(pool),
    allowedOrigins: (process.env.CP_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    supportSecret: process.env.SUPPORT_JWT_SECRET && process.env.SUPPORT_JWT_SECRET.length >= 32 ? process.env.SUPPORT_JWT_SECRET : undefined,
    // Accesos de las empresas: el Core por la red privada (el mismo destino que su pasarela), con el secreto compartido
    tenantAccess:
      process.env.SUPPORT_JWT_SECRET && process.env.SUPPORT_JWT_SECRET.length >= 32
        ? { client: coreAccessClient({ baseUrl: process.env.CP_CORE_INTERNAL_URL || DEFAULT_CORE_INTERNAL_URL, secret: process.env.SUPPORT_JWT_SECRET }) }
        : undefined,
    operators: operators.service,
    cookieSecure: operators.cookieSecure,
    trustProxy: process.env.CP_TRUST_PROXY ? Number(process.env.CP_TRUST_PROXY) || process.env.CP_TRUST_PROXY : undefined,
    publicIntake,
    web,
    subscriptions,
    capabilities,
    limits,
    trials,
    organization,
    orders,
    withdrawals,
    lifecycle,
    stripe,
    external,
    invoicing,
    commercialEvents,
    leadNotices,
    adminAlerts,
    dataRequests,
    notifications: notificationsFromEnv(process.env),
    mail: {
      platform: platformMail.mailer,
      webhookToken: process.env.BREVO_WEBHOOK_TOKEN ?? null,
      postmarkWebhookToken: process.env.POSTMARK_WEBHOOK_TOKEN ?? null,
      tenantLane: tenantLaneResolver({ dsnOf: (id) => registry.getActiveDsn(id), policy: mailPolicy }),
      // Trazabilidad de la bandeja de plataforma (la misma tabla del CRM; solo lectura)
      ledger: platformMail.mailer && crmPool ? new MysqlMailStore(crmPool) : null,
      sandbox: platformMail.mailer ? sandboxAccess : null,
      policy: mailPolicy,
      diagnostics: process.env.BREVO_API_KEY ? () => brevoDiagnostics({ apiKey: process.env.BREVO_API_KEY!, sendingDomain: mailPolicy.sendingDomain, baseUrl: process.env.BREVO_API_BASE_URL }) : undefined,
    },
  });

  const port = Number(process.env.CP_PORT ?? 4100);
  console.log(JSON.stringify({ ctx: "Notifications", dispatch: !!notificationsFromEnv(process.env), mail: !!platformMail.mailer, events: !!commercialEvents }));
  app.listen(port, () => console.log(JSON.stringify({ ctx: "ControlPlane", event: "listening", port })));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "error");
  process.exit(1);
});
