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
import { runAlerts } from "../_core/ops/alerts";
import { SsoService, parseSsoUsers } from "./sso";
import { createRemoteJWKSet } from "jose";

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
    const t = setInterval(() => void evaluate().catch(() => undefined), every);
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

  const app = createControlPlaneApp({
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
    platformTarget: process.env.CP_PLATFORM_TARGET ?? "",
    platformDomain: process.env.CP_PLATFORM_DOMAIN || undefined,
    support: new SupportAdmin(pool),
    allowedOrigins: (process.env.CP_ALLOWED_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    supportSecret: process.env.SUPPORT_JWT_SECRET && process.env.SUPPORT_JWT_SECRET.length >= 32 ? process.env.SUPPORT_JWT_SECRET : undefined,
  });

  const port = Number(process.env.CP_PORT ?? 4100);
  app.listen(port, () => console.log(JSON.stringify({ ctx: "ControlPlane", event: "listening", port })));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "error");
  process.exit(1);
});
