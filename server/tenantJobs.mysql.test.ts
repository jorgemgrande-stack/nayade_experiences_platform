/**
 * Tareas programadas heredadas en multiempresa con MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL):
 * dos empresas ficticias aprovisionadas desde la baseline, montaje real del registro
 * (`installTenantResolution`) y arranque de las tareas con `startScheduledJobsMulti`, como en
 * `bootMultiTenant`.
 *  - Todas corren por empresa; las de buzón IMAP solo con el buzón propio de cada empresa (nunca el del entorno).
 *  - Pasada inicial y dos ciclos de cron por empresa: sin errores de contexto ni errores en el log.
 *  - Cada tarea toca solo la base de su empresa (datos marcados por empresa) y avisa al correo de
 *    esa empresa, en su contexto.
 *  - El pool de la empresa sigue vivo tras «anulaciones sin atender» (antes lo cerraba).
 * Las tareas `abandoned-checkout` e `installment-overdue` viven en `_core/index.ts` (no importable
 * sin arrancar el servidor) y ya usan el programador por empresa con `getDb()`.
 * El modo single (sin cambios) se prueba en `tenantJobPolicy.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import mysql from "mysql2/promise";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const run = crypto.randomBytes(3).toString("hex");
const REG_DB = `jobs_reg_${run}`;
const OP = { type: "operator" as const, id: "prueba" };
const A = `joba-${run}`;
const B = `jobb-${run}`;

// Programación capturada: los ciclos de cron se disparan a mano (sin esperar al reloj)
const cronTicks = vi.hoisted(() => [] as Array<() => void>);
vi.mock("node-cron", () => {
  const schedule = (_expr: string, fn: () => void) => {
    cronTicks.push(fn);
    return { stop() {} };
  };
  return { default: { schedule }, schedule };
});

// Ningún correo real: se registra a qué empresa (contexto) y destinatario iría cada uno
const mails = vi.hoisted(() => [] as Array<{ tenant: string; to: string; subject: string; html: string }>);
vi.mock("./mailer", async () => {
  const { getTenantId } = await import("./_core/tenant");
  return {
    sendEmail: async (p: { to: string; subject: string; html: string }) => {
      mails.push({ tenant: getTenantId(), to: p.to, subject: p.subject, html: p.html });
      return true;
    },
  };
});

const FLAGS = [
  "cancellation_stale_job_enabled",
  "email_ingestion_enabled",
  "expense_email_ingestion_enabled",
  "commercial_email_enabled",
  "card_terminal_matching_enabled",
  "card_terminal_relink_enabled",
  "email_automation_job_enabled",
  "tax_reminder_job_enabled",
];
const CONTEXT_ERRORS = /TenantResolutionError|sin tenant|sin pool precargado|Pool is closed|Error en ciclo de sync|Job error|Boot error|Boot run error|No disponible en multiempresa|no disponible en multiempresa/i;

describe.skipIf(!URL_)("tareas programadas en multiempresa (dos empresas, MySQL real)", () => {
  let admin: mysql.Pool;
  let regPool: mysql.Pool;
  let svc: import("./_core/tenantRegistry/service").TenantRegistryService;
  let jobStatus: typeof import("./_core/tenantRegistry/scheduler").jobStatus;
  let closeAll: () => Promise<void>;
  const dsn: Record<string, string> = {};
  const errors: string[] = [];
  const warns: string[] = [];
  const infoLines: string[] = [];
  let started: string[] = [];

  const q = async (tenant: string, sqlText: string, params: unknown[] = []) => {
    const c = await mysql.createConnection({ uri: dsn[tenant] });
    try {
      return ((await c.query(sqlText, params)) as any)[0];
    } finally {
      await c.end();
    }
  };

  /** Espera a que cada tarea indicada haya terminado para las dos empresas después de `since`. */
  async function waitRuns(names: string[], since: number) {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const recs = jobStatus().filter((r) => r.startedAt >= since && names.includes(r.job));
      const done = names.every((n) => [A, B].every((t) => recs.some((r) => r.job === n && r.tenantId === t)));
      if (done) return recs;
      if (Date.now() > deadline) throw new Error(`Tareas sin terminar: ${JSON.stringify(recs)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  beforeAll(async () => {
    const u = new URL(URL_!);
    const regUrl = new URL(URL_!);
    regUrl.pathname = `/${REG_DB}`;
    process.env.TENANT_MODE = "multi";
    process.env.REGISTRY_DATABASE_URL = regUrl.toString();
    process.env.REGISTRY_KEYS = `k1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.REGISTRY_ACTIVE_KEY_ID = "k1";
    process.env.INTEGRATION_KEYS = `ik1:${crypto.randomBytes(32).toString("base64")}`;
    process.env.INTEGRATION_ACTIVE_KEY_ID = "ik1";
    process.env.DATABASE_URL = "mysql://nadie:nada@127.0.0.1:1/no_debe_usarse";
    delete process.env.SUPPORT_JWT_SECRET;
    // Si se arrancaran, las tareas de buzón global tendrían credenciales: no deben usarse
    process.env.IMAP_TPV_PASS = "no-debe-usarse";
    process.env.IMAP_EXPENSE_PASS = "no-debe-usarse";

    admin = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 6 });
    await admin.query(`CREATE DATABASE ${REG_DB} CHARACTER SET utf8mb4`);
    regPool = mysql.createPool({ uri: regUrl.toString(), multipleStatements: true, connectionLimit: 6 });
    const { migrateRegistry } = await import("./_core/tenantRegistry/migrate");
    await migrateRegistry(regPool, path.resolve(__dirname, "../db/registry"), { dryRun: false });

    const { MysqlTenantRegistryStore } = await import("./_core/tenantRegistry/mysqlStore");
    const { TenantRegistryService } = await import("./_core/tenantRegistry/service");
    const { keyringFromEnv } = await import("./_core/tenantRegistry/crypto");
    const { ProvisioningService } = await import("./_core/provisioning/service");
    const prov = await import("./_core/provisioning/mysqlAdapters");
    const { EntitlementAdmin } = await import("./_core/modules/mysqlEntitlements");
    const { QuotaAdmin } = await import("./_core/erm/mysqlQuotas");
    const store = new MysqlTenantRegistryStore(regPool);
    svc = new TenantRegistryService(store, () => keyringFromEnv(process.env));
    const p = new ProvisioningService({
      registry: svc,
      reader: store,
      databases: new prov.MysqlDatabaseProvisioner(admin, { host: u.hostname, port: Number(u.port || 3306) }),
      schema: new prov.MysqlSchemaApplier({ baselinePath: path.resolve(__dirname, "../db/baseline/0000_baseline.sql"), migrationsDir: path.resolve(__dirname, "../db/migrations") }),
      seeder: new prov.MysqlTenantSeeder(),
      entitlements: new EntitlementAdmin(regPool),
      quotas: new QuotaAdmin(regPool),
      store: new prov.MysqlProvisioningStore(regPool),
    });
    for (const id of [A, B]) {
      const r = await p.run({ tenantId: id, displayName: `Empresa ${id}`, adminEmail: `admin@${id}.example`, platformDomain: "elephantsource.es" }, OP);
      expect(r.status).toBe("completed");
      dsn[id] = (await svc.getActiveDsn(id))!;
    }

    // Datos marcados por empresa en SU base: flags activos, correos propios, una obligación fiscal
    // que vence en 5 días, una anulación sin atender de hace 3 días y un lote de datáfono pendiente
    const due = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    for (const id of [A, B]) {
      for (const f of FLAGS) {
        await q(id, "INSERT INTO feature_flags (`key`, name, enabled) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE enabled = 1", [f, f]);
      }
      for (const [k, v] of [["email_accounting", `contabilidad@${id}.example`], ["email_cancellations", `anulaciones@${id}.example`]]) {
        await q(id, "INSERT INTO system_settings (`key`, value, category, label) VALUES (?, ?, 'email', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [k, v, k]);
      }
      await q(id, "INSERT INTO tax_obligations (model, year, period_type, period_key, period_label, due_date) VALUES ('303', 2026, 'trimestral', ?, ?, ?)", [`T-${id}`, `Periodo ${id}`, due]);
      await q(id, "INSERT INTO cancellation_requests (full_name, activity_date, reason, created_at) VALUES (?, '2026-10-01', 'otra', NOW() - INTERVAL 3 DAY)", [`Cliente ${id}`]);
      await q(id, "INSERT INTO card_terminal_batches (batch_date, terminal_code) VALUES ('2026-10-01', ?)", [`TPV-${id}`]);
    }

    const { installTenantResolution } = await import("./_core/tenantRegistry/install");
    const { closeAllDatabases } = await import("./_core/dbRegistry");
    ({ jobStatus } = await import("./_core/tenantRegistry/scheduler"));
    const rt = installTenantResolution(express(), process.env)!;
    closeAll = async () => {
      await closeAllDatabases();
      await rt.close();
    };

    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(" ")));
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void warns.push(a.map(String).join(" ")));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { startScheduledJobsMulti } = await import("./_core/tenantRegistry/jobPolicy");
    const { startCancellationStaleJob } = await import("./cancellationStaleJob");
    const { startEmailAutomationJob } = await import("./emailAutomationJob");
    const { startTaxReminderJob } = await import("./taxReminderJob");
    const { startEmailIngestionJob } = await import("./services/emailTpvIngestionService");
    const { startExpenseEmailIngestionJob } = await import("./services/expenseEmailIngestionService");
    const { startCommercialEmailSyncJob } = await import("./services/commercialEmailService");
    const { startMatchingJob } = await import("./services/cardTerminalMatchingService");
    const { startRelinkJob } = await import("./services/cardTerminalRelinkService");
    // Mismo orden y flags que SCHEDULED_JOBS de _core/index.ts (sin las dos tareas internas de ese fichero)
    started = startScheduledJobsMulti(
      [
        { name: "cancellation-stale", flag: "cancellation_stale_job_enabled", start: startCancellationStaleJob, label: "Cancellation Stale", def: false },
        { name: "email-tpv-ingestion", flag: "email_ingestion_enabled", start: startEmailIngestionJob, label: "Email Ingestion", def: false },
        { name: "expense-email-ingestion", flag: "expense_email_ingestion_enabled", start: startExpenseEmailIngestionJob, label: "Expense Email Ingestion", def: false },
        { name: "commercial-email-sync", flag: "commercial_email_enabled", start: startCommercialEmailSyncJob, label: "Commercial Email Sync", def: false },
        { name: "card-terminal-matching", flag: "card_terminal_matching_enabled", start: startMatchingJob, label: "Card Terminal Matching", def: true },
        { name: "card-terminal-relink", flag: "card_terminal_relink_enabled", start: startRelinkJob, label: "Card Terminal Relink", def: true },
        { name: "email-automation", flag: "email_automation_job_enabled", start: startEmailAutomationJob, label: "Email Automation", def: false },
        { name: "tax-reminder", flag: "tax_reminder_job_enabled", start: startTaxReminderJob, label: "Tax Reminder", def: true },
      ],
      (l) => infoLines.push(l),
    );
  }, 300_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await closeAll?.();
    await regPool?.end();
    // El contenedor de pruebas es desechable: las BD de las empresas de prueba (id aleatorio) no se reutilizan
    await admin?.end();
  });

  it("todas por empresa: las de buzón IMAP solo leen el buzón propio de cada empresa (aquí ninguna lo tiene)", () => {
    expect(started).toEqual(["cancellation-stale", "email-tpv-ingestion", "expense-email-ingestion", "commercial-email-sync", "card-terminal-matching", "card-terminal-relink", "email-automation", "tax-reminder"]);
    expect(infoLines).toEqual([]);
    expect(cronTicks).toHaveLength(8);
  });

  it("pasada inicial por empresa (datáfono y correo comercial), dentro de su contexto y sin errores", async () => {
    const recs = await waitRuns(["card-terminal-matching", "card-terminal-relink", "commercial-email-sync"], 0);
    for (const r of recs) expect(r.outcome, `${r.job}/${r.tenantId}`).toBe("ok");
    expect(errors).toEqual([]);
    expect(warns.filter((w) => CONTEXT_ERRORS.test(w))).toEqual([]);
  });

  it("dos ciclos de cron: cada tarea corre una vez por empresa, sin errores, y toca solo su base", async () => {
    for (let round = 0; round < 2; round++) {
      const since = Date.now();
      for (const tick of cronTicks) tick();
      const recs = await waitRuns(started, since);
      for (const r of recs) expect(r.outcome, `${r.job}/${r.tenantId}`).toBe("ok");
      expect(recs.every((r) => r.tenantId === A || r.tenantId === B)).toBe(true);
    }
    expect(errors).toEqual([]);
    expect(warns.filter((w) => CONTEXT_ERRORS.test(w))).toEqual([]);

    for (const [id, other] of [[A, B], [B, A]]) {
      // Escrituras en su base (y solo su fila: la base no contiene datos de la otra empresa)
      const [tax] = await q(id, "SELECT period_label, last_reminder_days FROM tax_obligations");
      expect(tax).toEqual({ period_label: `Periodo ${id}`, last_reminder_days: 7 });
      const batches = await q(id, "SELECT terminal_code, matching_run_at FROM card_terminal_batches");
      expect(batches).toHaveLength(1);
      expect(batches[0].terminal_code).toBe(`TPV-${id}`);
      expect(batches[0].matching_run_at).not.toBeNull();

      // Avisos enviados en el contexto de su empresa, a sus correos y con sus datos
      const own = mails.filter((m) => m.tenant === id);
      expect(own.length).toBeGreaterThan(0);
      for (const m of own) {
        expect(m.to).toMatch(new RegExp(`@${id}\\.example$`));
        expect(m.subject + m.html).not.toContain(other);
      }
      expect(own.some((m) => m.subject.includes(`Periodo ${id}`))).toBe(true);
      expect(own.some((m) => m.html.includes(`Cliente ${id}`))).toBe(true);
    }
    // Aviso fiscal idempotente: uno por empresa pese a los dos ciclos; anulaciones: una por ciclo
    expect(mails.filter((m) => m.subject.includes("Vencimiento fiscal"))).toHaveLength(2);
    expect(mails.filter((m) => m.html.includes("Cliente "))).toHaveLength(4);
  });
});
