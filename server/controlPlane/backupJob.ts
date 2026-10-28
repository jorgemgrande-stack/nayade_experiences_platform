/**
 * Copias de seguridad de Elephant Source: trabajo programable y órdenes de operación.
 * Se empaqueta con `pnpm build:cp` en `dist-cp/backup-job.js` (misma imagen que el plano de control).
 *
 *   node dist-cp/backup-job.js run [--only a,b] [--no-platform]      copia todas las empresas + registro + CRM
 *   node dist-cp/backup-job.js list [--tenant id] [--kind tenant|registry|crm|files|config] [--destination primary|secondary] [--limit 50]
 *   node dist-cp/backup-job.js objects <prefijo> [--source primary|secondary]   objetos del almacenamiento (sin registro)
 *   node dist-cp/backup-job.js retention [--destination primary|secondary] [--apply]   retención 30/12/12 por destino
 *   node dist-cp/backup-job.js restore-tenant <empresa> [--source primary|secondary] [--backup <id>] [--server <alias>] [--apply] [--switch]
 *   node dist-cp/backup-job.js restore-platform <registry|crm> --admin-url-env VAR --database <nueva>
 *        [--source primary|secondary] [--backup <id> | --manifest <clave>] [--apply]
 *   node dist-cp/backup-job.js restore-files <empresa> (--out <directorio> | --to-media) [--source primary|secondary]
 *   node dist-cp/backup-job.js recovery-package [--source primary|secondary]      paquete de configuración (sin secretos)
 *   node dist-cp/backup-job.js estimate [--days 7] [--runs-per-day 96] [--price-gb N --price-a N --price-b N]
 *   node dist-cp/backup-job.js restores [--limit 50]                              registro de restauraciones
 *   node dist-cp/backup-job.js rebuild --admin-url-env VAR --server <alias> [--source secondary] [--registry-db es_registry]
 *        [--crm-db es_crm] [--to-media] [--only a,b] [--apply]                     reconstrucción total (RECUPERACION_TOTAL.md)
 *   node dist-cp/backup-job.js migrate-tenants [--only a,b] [--apply]   carril de la app en cada empresa (red privada)
 *   node dist-cp/backup-job.js check-data-exports [--only a,b]          verificación (solo lectura) de 0011/0012/0013
 *   node dist-cp/backup-job.js erm-setup [--apply]                       base de medición es_erm (idempotente; ES_ERM_PASSWORD)
 *   node dist-cp/backup-job.js purge-test-companies [--apply]             purga DEFINITIVA de las 5 empresas de prueba (lista
 *                                                                        cerrada; simulación salvo --apply; ver purgeTestCompanies.ts)
 *   node dist-cp/backup-job.js orphans                                   recursos huérfanos del aprovisionamiento (solo lectura)
 *
 * (en desarrollo: `pnpm exec tsx server/controlPlane/backupJob.ts <orden>`)
 *
 * Variables: REGISTRY_ADMIN_DATABASE_URL, REGISTRY_KEYS/REGISTRY_ACTIVE_KEY_ID (DSN de las empresas),
 * BACKUP_KEYS/BACKUP_ACTIVE_KEY_ID (cifrado de copias), BACKUP_STORAGE + BACKUP_S3_* o BACKUP_FS_DIR,
 * BACKUP_SECONDARY_* (destino secundario, opcional), CRM_DATABASE_URL (opcional), BACKUP_MEDIA=1 + S3_*
 * (ficheros, opcional), BACKUP_APPLY_RETENTION=1 / BACKUP_SECONDARY_APPLY_RETENTION=1 (retención tras
 * cada copia, por destino), PROVISIONING_DB_SERVERS / PROVISIONING_DB_ADMIN_URL (restauración).
 *
 * Garantías: las restauraciones son simulación salvo `--apply`; solo `--switch` apunta el registro a la
 * base restaurada. Las salidas no contienen DSN, contraseñas ni claves (solo identificadores y huellas).
 * Código de salida 1 si falla cualquier copia, también solo en el secundario (la copia primaria ya hecha
 * sigue siendo válida).
 */
import path from "node:path";
import { runErmSetup } from "../_core/erm/setup";
import { orphanReport } from "../_core/provisioning/orphans";
import mysql from "mysql2/promise";
import { keyringFromEnv } from "../_core/tenantRegistry/crypto";
import { MysqlTenantRegistryStore } from "../_core/tenantRegistry/mysqlStore";
import { TenantRegistryService, type Actor } from "../_core/tenantRegistry/service";
import { backupKeyringFromEnv } from "../_core/ops/backupCrypto";
import {
  backupStorageFromEnv,
  mediaSourceFromEnv,
  mediaTargetFromEnv,
  secondaryBackupStorageFromEnv,
  type BackupStorage,
  type MediaTarget,
} from "../_core/ops/backupStorage";
import { MysqlBackupInventory, safeError, type BackupTargetKind } from "../_core/ops/backupInventory";
import { MysqlBackupCopyLedger, type BackupDestination, type CopyTargetKind } from "../_core/ops/backupCopies";
import { restoreTenantFiles, runBackupJob, type SecondaryTarget } from "../_core/ops/backupJob";
import { applyBackupRetention, applyCopyRetention, gfsPolicyFromEnv } from "../_core/ops/backupRetention";
import { restorePlatformDatabase, restoreTenant, restoredDatabaseName, restoredUserFor } from "../_core/ops/backupRestore";
import { buildRecoveryPackage, readRecoveryPackage } from "../_core/ops/recoveryPackage";
import { estimateMonthly } from "../_core/ops/backupEstimate";
import { rebuildPlatform } from "../_core/ops/disasterRecovery";
import { DatabaseServers, MultiServerDatabaseProvisioner, parseDatabaseServers } from "../_core/provisioning/servers";
import { MysqlSchemaApplier, databaseNameFor } from "../_core/provisioning/mysqlAdapters";
import { applyPurge, planPurge, verifyPurge } from "../_core/ops/purgeTestCompanies";
import { migrateAllTenants } from "../_core/ops/tenantMigrations";
import { dataExportSchemaStatus } from "../_core/ops/dataExportCheck";
import { BUILTIN_MODULES } from "../_core/modules/builtin";
import { MysqlWebStore } from "../web/store";
import { WebAdminService } from "../web/service";
import { applyStatusReview, fillEvidence } from "../catalog/review";
import { EVIDENCE_2026_10_25, REVIEW_ID, STATUS_REVIEW_2026_10_25 } from "../catalog/review20261025";
import { IMPORT_AUTHOR, importCommercialSpecs } from "../catalog/commercial/importSpecs";
import { publishBatch, revertLastBatch } from "../catalog/commercial/publishBatch";
import { commercialIntegrity } from "../catalog/commercial/integrity";

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith("--") ? args[0] : "run";
const BOOLEAN_FLAGS = new Set(["--apply", "--switch", "--no-platform", "--to-media"]);
const pos: string[] = [];
for (let i = args[0] === cmd ? 1 : 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    if (!BOOLEAN_FLAGS.has(args[i])) i++;
  } else pos.push(args[i]);
}
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const actor: Actor = { type: "operator", id: opt("--actor") ?? process.env.USERNAME ?? process.env.USER ?? "backup-job" };
const actorLabel = `${actor.type}:${actor.id}`;

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}
const print = (o: unknown) => console.log(JSON.stringify(o, null, 2));
const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ ctx: "Backups", event, ...data }));

function storageOrDie(): BackupStorage {
  const s = backupStorageFromEnv(process.env);
  if (!s.storage) die(`Almacenamiento de copias no disponible: ${(s as { reason: string }).reason}`);
  return s.storage;
}

function destinationOpt(name: string, fallback: BackupDestination = "primary"): BackupDestination {
  const v = opt(name) ?? fallback;
  if (v !== "primary" && v !== "secondary") die(`${name} debe ser primary o secondary`);
  return v;
}

/** Almacenamiento del origen elegido; el secundario debe estar configurado y completo. */
function sourceStorageOrDie(source: BackupDestination): BackupStorage {
  if (source === "primary") return storageOrDie();
  const s = secondaryBackupStorageFromEnv(process.env);
  if (!s.storage) die(`Destino secundario no disponible: ${s.reason}`);
  return s.storage;
}

function secondaryTimeoutMs(): number {
  const n = Number(process.env.BACKUP_SECONDARY_TIMEOUT_SECONDS ?? 600);
  return (Number.isFinite(n) && n >= 5 ? n : 600) * 1000;
}

function filesOutOrDie(): string | MediaTarget {
  if (flag("--to-media")) {
    const t = mediaTargetFromEnv(process.env);
    if (!t.target) die((t as { reason: string }).reason);
    return t.target;
  }
  return path.resolve(opt("--out") ?? die("Falta --out <directorio> o --to-media"));
}

function dbNameOf(url: string): string | null {
  try {
    return new URL(url).pathname.slice(1) || null;
  } catch {
    return null;
  }
}

async function main() {
  const regUrl = process.env.REGISTRY_ADMIN_DATABASE_URL;
  const source = destinationOpt("--source", cmd === "rebuild" ? "secondary" : "primary");
  // `objects`, `restore-files`, `recovery-package` y `rebuild` funcionan sin registro (recuperación ante desastre)
  if (cmd === "objects") {
    const prefix = pos[0] ?? "";
    for (const o of await sourceStorageOrDie(source).list(prefix)) console.log(`${o.bytes}\t${o.key}`);
    return;
  }
  if (cmd === "recovery-package") {
    const pkg = await readRecoveryPackage(sourceStorageOrDie(source), backupKeyringFromEnv(process.env), opt("--key") ?? undefined);
    if (!pkg) die("No hay paquete de recuperación en ese destino");
    print(pkg);
    return;
  }
  if (cmd === "restore-files" && !regUrl) {
    // Sin registro: no queda constancia en backup_restores (no hay dónde escribirla)
    const id = pos[0] ?? die("Falta <empresa>");
    print(await restoreTenantFiles({ storage: sourceStorageOrDie(source), ring: backupKeyringFromEnv(process.env), source, actor: actorLabel }, id, filesOutOrDie()));
    return;
  }
  if (cmd === "restore-platform" && opt("--manifest")) {
    // Sin registro: restaurar el propio registro (o el CRM) a partir del manifiesto
    const kind = (pos[0] ?? die("Falta registry|crm")) as "registry" | "crm";
    if (kind !== "registry" && kind !== "crm") die("Destino no válido: registry o crm");
    const envName = opt("--admin-url-env") ?? die("Falta --admin-url-env <VARIABLE>");
    const adminUrl = process.env[envName] ?? die(`La variable ${envName} no está definida`);
    const database = opt("--database") ?? die("Falta --database <base nueva>");
    if (!flag("--apply")) return void console.log(`[dry-run] restaurar ${kind} (${opt("--manifest")}, origen ${source}) en la base NUEVA ${database} (usa --apply)`);
    const rep = await restorePlatformDatabase(
      { storage: sourceStorageOrDie(source), ring: backupKeyringFromEnv(process.env) },
      { kind, manifestKey: opt("--manifest")!, source, adminUrl, database, actor: actorLabel },
    );
    print(rep);
    if (!rep.verification.ok) process.exitCode = 1;
    return;
  }
  if (cmd === "rebuild") return rebuild(source);

  if (!regUrl) die("Falta REGISTRY_ADMIN_DATABASE_URL");
  const pool = mysql.createPool({ uri: regUrl, connectionLimit: 3 });
  const servers = (() => {
    const cfg = parseDatabaseServers(process.env);
    return cfg ? new DatabaseServers(cfg) : null;
  })();
  try {
    const store = new MysqlTenantRegistryStore(pool);
    const inventory = new MysqlBackupInventory(pool);
    const ledger = new MysqlBackupCopyLedger(pool);
    const copies = (await ledger.ready()) ? ledger : null;
    const registry = new TenantRegistryService(store, () => keyringFromEnv(process.env));

    switch (cmd) {
      case "run": {
        const storage = storageOrDie();
        const ring = backupKeyringFromEnv(process.env);
        const media = mediaSourceFromEnv(process.env);
        const sec = secondaryBackupStorageFromEnv(process.env);
        let secondary: SecondaryTarget | undefined;
        if (sec.configured) {
          secondary = copies
            ? { storage: sec.storage, unavailableReason: sec.reason, copies, timeoutMs: secondaryTimeoutMs() }
            : { storage: null, unavailableReason: "Falta la migración 0011 del registro (backup_copies): el secundario no se usa", copies: null };
        }
        log("run_started", {
          storage: storage.describe(),
          secondary: secondary?.storage?.describe() ?? null,
          ...(secondary && !secondary.storage ? { secondaryReason: secondary.unavailableReason } : {}),
          keyId: ring.activeKeyId,
          media: media.media ? media.media.describe() : null,
          ...(media.media ? {} : { mediaReason: (media as { reason: string }).reason }),
        });
        const crmUrl = process.env.CRM_DATABASE_URL || undefined;
        const registryVersion = await pool
          .query<mysql.RowDataPacket[]>("SELECT v FROM registry_meta WHERE k = 'schema_version'")
          .then(([r]) => (r[0]?.v as string | undefined) ?? null, () => null);
        const rep = await runBackupJob({
          reader: store,
          tenantDsn: (id) => registry.getActiveDsn(id),
          registryDsn: regUrl,
          crmDsn: crmUrl,
          storage,
          ring,
          inventory,
          media: media.media ?? undefined,
          only: opt("--only")?.split(",").filter(Boolean),
          includePlatform: !flag("--no-platform"),
          secondary,
          copies,
          recovery: async (_results, runId) =>
            buildRecoveryPackage({
              runId,
              now: Date.now(),
              env: process.env,
              reader: store,
              registry: { database: dbNameOf(regUrl), schemaVersion: registryVersion },
              crm: { configured: !!crmUrl, database: crmUrl ? dbNameOf(crmUrl) : null },
              destinations: { primary: storage, ...(secondary ? { secondary: secondary.storage } : {}) },
              ring,
              retention: { primary: gfsPolicyFromEnv(process.env), ...(secondary ? { secondary: gfsPolicyFromEnv(process.env, "BACKUP_SECONDARY_KEEP_") } : {}) },
              latest: async (dest, tenantId) => {
                if (dest === "primary") {
                  const r = (await inventory.list({ targetKind: "tenant", targetId: tenantId, status: "ok", limit: 1 }))[0];
                  return r ? { manifestKey: r.manifestKey, createdAt: r.finishedAt } : null;
                }
                const r = copies ? (await copies.list({ destination: "secondary", targetKind: "tenant", targetId: tenantId, status: "ok", limit: 1 }))[0] : undefined;
                return r ? { manifestKey: r.manifestKey, createdAt: r.finishedAt } : null;
              },
            }),
          log,
        });
        log("run_finished", {
          runId: rep.runId,
          ok: rep.ok,
          durationMs: rep.finishedAt - rep.startedAt,
          copied: rep.results.filter((r) => r.status === "ok").length,
          failed: rep.results.filter((r) => r.status === "failed").length,
          skipped: rep.results.filter((r) => r.status === "skipped").map((r) => r.id),
          bytes: rep.results.reduce((n, r) => n + (r.bytes ?? 0), 0),
          bytesByKind: rep.metrics.bytes,
          msByKind: rep.metrics.durations,
          secondary: rep.secondary,
        });
        if (process.env.BACKUP_APPLY_RETENTION === "1") {
          const ret = await applyBackupRetention({ inventory, storage }, { apply: true, policy: gfsPolicyFromEnv(process.env) });
          log("retention", { destination: "primary", deleted: ret.deleted, errors: ret.errors.length });
        }
        if (secondary?.storage && copies) {
          // Simulación siempre; borrado solo con BACKUP_SECONDARY_APPLY_RETENTION=1 (activar tras revisar la simulación)
          const apply = process.env.BACKUP_SECONDARY_APPLY_RETENTION === "1";
          const ret = await applyCopyRetention({ copies, storage: secondary.storage, destination: "secondary" }, { apply, policy: gfsPolicyFromEnv(process.env, "BACKUP_SECONDARY_KEEP_") });
          log("retention", { destination: "secondary", applied: apply, toDelete: ret.toDelete.length, deleted: ret.deleted, skipped: ret.skipped.length, errors: ret.errors.length });
        }
        if (!rep.ok || (rep.secondary && !rep.secondary.ok)) process.exitCode = 1;
        break;
      }
      case "list": {
        if (destinationOpt("--destination") === "secondary") {
          if (!copies) die("Falta la migración 0011 del registro (backup_copies)");
          const rows = await copies.list({ destination: "secondary", targetKind: opt("--kind") as CopyTargetKind | undefined, targetId: opt("--tenant"), limit: Number(opt("--limit") ?? 50) });
          console.table(rows.map((r) => ({ copia: r.backupId ?? "", destino: `${r.targetKind}:${r.targetId}`, estado: r.status, inicio: new Date(r.startedAt).toISOString(), ms: r.durationMs, bytes: r.bytes, error: r.error ?? "" })));
          break;
        }
        const rows = await inventory.list({
          targetKind: opt("--kind") as BackupTargetKind | undefined,
          targetId: opt("--tenant"),
          limit: Number(opt("--limit") ?? 50),
        });
        console.table(rows.map((r) => ({ id: r.id, destino: `${r.targetKind}:${r.targetId}`, estado: r.status, inicio: new Date(r.startedAt).toISOString(), ms: r.durationMs, bytes: r.bytes, clave: r.keyId, servidor: r.serverAlias ?? "", error: r.error ?? "" })));
        break;
      }
      case "migrate-tenants": {
        // Carril de la app (db/migrations) en la base ACTIVA de cada empresa, con el mismo aplicador que el
        // aprovisionamiento (conoce la baseline). Se ejecuta dentro de la red privada; simulación salvo --apply.
        const schema = new MysqlSchemaApplier({
          baselinePath: path.resolve(process.cwd(), "db/baseline/0000_baseline.sql"),
          migrationsDir: path.resolve(process.cwd(), "db/migrations"),
        });
        const res = await migrateAllTenants({ reader: store, registry, schema, actor }, { apply: flag("--apply"), only: opt("--only")?.split(",").filter(Boolean) });
        print(res.map((r) => ({ tenant: r.tenantId, resultado: r.outcome, pendientes: r.pending ?? [], esquema: r.schemaVersion ?? null, error: r.error ?? null })));
        if (res.some((r) => r.outcome === "failed")) process.exitCode = 1;
        break;
      }
      case "check-data-exports": {
        // Solo lectura: ¿tiene cada empresa la tabla y las columnas de la exportación? (tras migrate-tenants --apply)
        const only = opt("--only")?.split(",").filter(Boolean);
        const out: Array<Record<string, unknown>> = [];
        for (const t of await store.listTenants()) {
          if (only && !only.includes(t.id)) continue;
          if (["provisioning", "archived", "deleting", "deleted"].includes(t.status)) continue;
          const dsn = await registry.getActiveDsn(t.id).catch(() => null);
          if (!dsn) {
            out.push({ tenant: t.id, ok: false, error: "sin base de datos activa" });
            continue;
          }
          const conn = await mysql.createConnection({ uri: dsn });
          try {
            const s = await dataExportSchemaStatus(async (q, p) => (await conn.query(q, p))[0] as Array<Record<string, unknown>>);
            out.push({ tenant: t.id, estado: t.status, ok: s.ok, faltan: s.missing, enCurso: s.pending });
          } catch (e) {
            out.push({ tenant: t.id, ok: false, error: e instanceof Error ? e.name : "error" });
          } finally {
            await conn.end().catch(() => undefined);
          }
        }
        print(out);
        if (out.some((r) => !r.ok)) process.exitCode = 1;
        break;
      }
      case "restores": {
        if (!copies) die("Falta la migración 0011 del registro (backup_restores)");
        console.table(
          (await copies.listRestores(Number(opt("--limit") ?? 50))).map((r) => ({
            id: r.id,
            inicio: new Date(r.startedAt).toISOString(),
            origen: r.source,
            destino: `${r.targetKind}:${r.targetId}`,
            base: r.databaseName ?? "",
            estado: r.status,
            verificada: r.verified,
            conmutada: r.switched,
            ficheros: r.filesCount ?? "",
            error: r.error ?? "",
          })),
        );
        break;
      }
      case "retention": {
        const dest = destinationOpt("--destination");
        const rep =
          dest === "secondary"
            ? await applyCopyRetention(
                { copies: copies ?? die("Falta la migración 0011 del registro (backup_copies)"), storage: secondaryBackupStorageFromEnv(process.env).storage, destination: "secondary" },
                { apply: flag("--apply"), policy: gfsPolicyFromEnv(process.env, "BACKUP_SECONDARY_KEEP_") },
              )
            : await applyBackupRetention({ inventory, storage: backupStorageFromEnv(process.env).storage }, { apply: flag("--apply"), policy: gfsPolicyFromEnv(process.env) });
        print({ destination: dest, ...rep, toDelete: rep.toDelete.length, sample: rep.toDelete.slice(0, 20) });
        if (!flag("--apply")) console.log("[dry-run] usa --apply para borrar");
        if (rep.errors.length) process.exitCode = 1;
        break;
      }
      case "estimate": {
        const days = Number(opt("--days") ?? 7);
        const since = Date.now() - days * 86_400_000;
        const rows = (await inventory.list({ status: "ok", limit: 5000 })).filter((r) => r.startedAt >= since);
        const db = new Map<string, { kind: string; id: string; total: number; n: number }>();
        const filesTenants = new Set<string>();
        const durations: number[] = [];
        for (const r of rows) {
          if (r.targetKind === "files") {
            filesTenants.add(r.targetId);
            continue;
          }
          const k = `${r.targetKind}:${r.targetId}`;
          const e = db.get(k) ?? { kind: r.targetKind, id: r.targetId, total: 0, n: 0 };
          e.total += r.bytes ?? 0;
          e.n++;
          db.set(k, e);
          if (r.durationMs) durations.push(r.durationMs);
        }
        const filesBytes = (await inventory.list({ targetKind: "files", status: "ok", limit: 5000 })).reduce((n, r) => n + (r.bytes ?? 0), 0);
        const prices = opt("--price-gb") ? { perGbMonth: Number(opt("--price-gb")), perMillionA: Number(opt("--price-a") ?? 0), perMillionB: Number(opt("--price-b") ?? 0) } : undefined;
        const est = estimateMonthly({
          policy: gfsPolicyFromEnv(process.env),
          runsPerDay: Number(opt("--runs-per-day") ?? 96),
          databases: Array.from(db.values()).map((e) => ({ kind: e.kind, id: e.id, avgBytes: e.n ? e.total / e.n : 0 })),
          filesBytes,
          tenantsWithFiles: filesTenants.size,
          prices,
        });
        print({ dias: days, copiasMedidas: rows.length, destinos: db.size, duracionMediaMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null, ...est });
        break;
      }
      case "restore-files": {
        const id = pos[0] ?? die("Falta <empresa>");
        print(await restoreTenantFiles({ storage: sourceStorageOrDie(source), ring: backupKeyringFromEnv(process.env), copies, source, actor: actorLabel }, id, filesOutOrDie()));
        break;
      }
      case "purge-test-companies": {
        // Purga definitiva de las cinco empresas de prueba (lista cerrada en el código, autorizada por el propietario):
        // simulación siempre; con --apply ejecuta el plan simulado y comprueba que no queda nada ni referencias huérfanas
        const apply = flag("--apply");
        const crmUrl = process.env.CRM_DATABASE_URL || die("Falta CRM_DATABASE_URL");
        const crmPool = mysql.createPool({ uri: crmUrl, connectionLimit: 2 });
        try {
          const dbs = servers ? new MultiServerDatabaseProvisioner(servers, { usage: async () => ({}) }) : null;
          const tenantDbName = async (t: string) => {
            const dsn = await registry.getActiveDsn(t).catch(() => null);
            return dsn ? dbNameOf(dsn) : null;
          };
          const plan = await planPurge({ crm: crmPool, registry: pool, tenantDbName, expectedDbName: (t) => databaseNameFor(t) });
          print({ simulacion: true, empresas: plan.companies, yaNoEstan: plan.missing, registros: plan.steps.map((s) => ({ base: s.db, tabla: s.table, filas: s.rows })), basesDeDatos: plan.databases, seConservan: plan.kept, problemas: plan.problems });
          if (plan.problems.length) die("La simulación tiene problemas: no se purga nada");
          if (!apply) break;
          if (!dbs && plan.databases.some((x) => x.action === "drop")) die("Falta PROVISIONING_DB_SERVERS o PROVISIONING_DB_ADMIN_URL para borrar las bases de los tenants");
          // Base restaurada activa (`es_<empresa>_r<fecha>`, nombre ya validado por el plan): ella y su usuario propio
          const dropRestoredDatabase = servers
            ? async (_t: string, database: string) => {
                for (const a of servers.aliases()) {
                  await servers.admin(a).query(`DROP DATABASE IF EXISTS \`${database}\``);
                  await servers.admin(a).query("DROP USER IF EXISTS ?@?", [restoredUserFor(database), "%"]);
                }
              }
            : undefined;
          const done = await applyPurge({ crm: crmPool, registry: pool, dropDatabase: dbs ? (t) => dbs.dropDatabase(t) : undefined, dropRestoredDatabase }, plan);
          const check = await verifyPurge({ crm: crmPool, registry: pool });
          print({ aplicado: true, borrados: done.deleted, basesBorradas: done.droppedDatabases, comprobacion: check });
          if (!check.ok) process.exitCode = 1;
        } finally {
          await crmPool.end();
        }
        break;
      }
      case "orphans": {
        // Solo lectura: bases y usuarios de los servidores frente al registro (nunca borra nada)
        if (!servers) die("Falta PROVISIONING_DB_SERVERS o PROVISIONING_DB_ADMIN_URL");
        const serverDatabases: Record<string, string[]> = {};
        const serverUsers: Record<string, string[]> = {};
        for (const alias of servers.aliases()) {
          const admin = servers.admin(alias);
          serverDatabases[alias] = ((await admin.query<mysql.RowDataPacket[]>("SELECT SCHEMA_NAME AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'es\\_%'"))[0]).map((r) => String(r.n));
          serverUsers[alias] = ((await admin.query<mysql.RowDataPacket[]>("SELECT DISTINCT User AS u FROM mysql.user WHERE User LIKE 'esu\\_%' OR User LIKE 'esr\\_%'"))[0]).map((r) => String(r.u));
        }
        const tenants = [];
        for (const t of await store.listTenants()) {
          if (t.status === "deleted") continue;
          const dsn = await registry.getActiveDsn(t.id).catch(() => null);
          tenants.push({ id: t.id, status: t.status, activeDatabase: dsn ? dbNameOf(dsn) : null });
        }
        const rep = orphanReport({ serverDatabases, serverUsers, tenants });
        print({ empresas: tenants.length, servidores: servers.aliases(), ...rep });
        if (!rep.ok) process.exitCode = 1;
        break;
      }
      case "catalog-review": {
        // Revisión de estados comerciales del catálogo (server/catalog/review20261025.ts) por el flujo normal del CRM,
        // con autor e historial; simulación salvo --apply. Nunca toca precios, licencias, Stripe ni cobros.
        const crmUrl = process.env.CRM_DATABASE_URL || die("Falta CRM_DATABASE_URL (base del CRM con el catálogo)");
        const crmPool = mysql.createPool({ uri: crmUrl, connectionLimit: 2 });
        try {
          const webStore = new MysqlWebStore(crmPool);
          const svc = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } });
          const author = `operacion:${REVIEW_ID}`;
          const apply = flag("--apply");
          const rep = await applyStatusReview(svc, webStore, STATUS_REVIEW_2026_10_25, { apply, author });
          const evidence = await fillEvidence(svc, webStore, EVIDENCE_2026_10_25, { apply, author });
          print({ revision: REVIEW_ID, ...rep, evidenciaRellenada: evidence });
          // Un conflicto (estado cambiado desde el CRM o borrador ajeno) no es un fallo: se informa y se respeta
        } finally {
          await crmPool.end().catch(() => undefined);
        }
        break;
      }
      case "catalog-commercial-import": {
        // Fichas comerciales y política propuesta en los BORRADORES del catálogo (server/catalog/commercial/importSpecs.ts)
        // por el flujo normal del CRM, con autor e historial; simulación salvo --apply. Nunca publica ni toca precios,
        // licencias, Stripe ni cobros; un producto que cambiaría algo fuera de la ficha no se guarda.
        const crmUrl = process.env.CRM_DATABASE_URL || die("Falta CRM_DATABASE_URL (base del CRM con el catálogo)");
        const crmPool = mysql.createPool({ uri: crmUrl, connectionLimit: 2 });
        try {
          const webStore = new MysqlWebStore(crmPool);
          const svc = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } });
          const before = await svc.publicSite("published").catch(() => null);
          const rep = await importCommercialSpecs(svc, webStore, { dryRun: !flag("--apply"), author: IMPORT_AUTHOR });
          const after = await svc.publicSite("published").catch(() => null);
          // Una sola línea: el registro de Railway puede llegar desordenado o recortado si la salida ocupa muchas líneas
          const count = (m: Record<string, string[]>) => Object.values(m).flat().reduce<Record<string, number>>((o, k) => ((o[k] = (o[k] ?? 0) + 1), o), {});
          console.log(JSON.stringify({ simulacion: rep.dryRun, actualizables: rep.updated.length, sinCambios: rep.unchanged, faltan: rep.missing, fallos: rep.failed, campos: count(rep.fields), normalizados: count(rep.normalized), publicado: { antes: before?.version ?? null, despues: after?.version ?? null } }));
          if (rep.failed.length || rep.missing.length || before?.version !== after?.version) process.exitCode = 1;
        } finally {
          await crmPool.end().catch(() => undefined);
        }
        break;
      }
      case "catalog-commercial-publish":
      case "catalog-commercial-revert": {
        // Publicación por lotes de las fichas comerciales (server/catalog/commercial/publishBatch.ts) o reversión del último
        // lote; simulación salvo --apply. Solo vuelve a publicar productos ya publicados cuyo borrador solo cambia en la ficha;
        // lo bloqueado queda en borrador con su causa. Nunca toca precios, licencias, Stripe ni cobros.
        const crmUrl = process.env.CRM_DATABASE_URL || die("Falta CRM_DATABASE_URL (base del CRM con el catálogo)");
        const crmPool = mysql.createPool({ uri: crmUrl, connectionLimit: 2 });
        try {
          const webStore = new MysqlWebStore(crmPool);
          const svc = new WebAdminService({ store: webStore, refs: { moduleIds: BUILTIN_MODULES.map((m) => m.id), planIds: () => null } });
          const before = await svc.publicSite("published").catch(() => null);
          const prices = JSON.stringify((await webStore.listPrices()).map((p) => [p.id, p.status, p.amountCents]));
          const apply = flag("--apply");
          const rep = cmd === "catalog-commercial-publish" ? await publishBatch(svc, webStore, { apply }) : await revertLastBatch(svc, webStore, { apply });
          const after = await svc.publicSite("published").catch(() => null);
          const pricesSame = JSON.stringify((await webStore.listPrices()).map((p) => [p.id, p.status, p.amountCents])) === prices;
          // Una sola línea (el registro de Railway la guarda en los atributos si es JSON)
          console.log(JSON.stringify({ orden: cmd, ...rep, preciosIntactos: pricesSame, publicado: { antes: before?.version ?? null, despues: after?.version ?? null } }));
          if (rep.failed.length || !pricesSame) process.exitCode = 1;
        } finally {
          await crmPool.end().catch(() => undefined);
        }
        break;
      }
      case "commercial-integrity": {
        // Solo lectura: recuentos y huellas de suscripciones, partidas, pedidos, pagos, Stripe y licencias (sin datos
        // personales) para comprobar que una operación del catálogo no ha tocado nada de eso.
        const crmUrl = process.env.CRM_DATABASE_URL || die("Falta CRM_DATABASE_URL (base del CRM)");
        const crmPool = mysql.createPool({ uri: crmUrl, connectionLimit: 2 });
        try {
          console.log(JSON.stringify({ orden: cmd, ...(await commercialIntegrity(crmPool, pool)) }));
        } finally {
          await crmPool.end().catch(() => undefined);
        }
        break;
      }
      case "erm-setup": {
        // Base del Resource Manager en el servidor de BD de la plataforma (el primero o el por defecto), en la red privada
        if (!servers) die("Falta PROVISIONING_DB_SERVERS o PROVISIONING_DB_ADMIN_URL (servidor de la base de medición)");
        const alias = process.env.PROVISIONING_DB_DEFAULT_SERVER || servers.aliases()[0];
        const srv = servers.server(alias);
        const res = await runErmSetup({ admin: servers.admin(alias), host: srv.host, port: srv.port, password: process.env.ES_ERM_PASSWORD, apply: flag("--apply") });
        print({ servidor: alias, ...res });
        if (res.grants === "excess" || (res.probe && !(res.probe.write && res.probe.deleteDenied && res.probe.ddlDenied && res.probe.otherDbDenied))) process.exitCode = 1;
        break;
      }
      case "restore-tenant": {
        const id = pos[0] ?? die("Falta <empresa>");
        if (!servers) die("Falta PROVISIONING_DB_SERVERS o PROVISIONING_DB_ADMIN_URL (servidor donde restaurar)");
        const backupId = opt("--backup") ? Number(opt("--backup")) : undefined;
        if (!flag("--apply")) {
          let copia: Record<string, unknown> | null = null;
          if (source === "secondary") {
            if (!copies) die("Falta la migración 0011 del registro (backup_copies)");
            const rows = await copies.list({ destination: "secondary", targetKind: "tenant", targetId: id, status: "ok", limit: backupId ? 5000 : 1 });
            const c = backupId ? rows.find((r) => r.backupId === backupId) : rows[0];
            copia = c ? { id: c.backupId, origen: "secondary", fecha: new Date(c.finishedAt).toISOString() } : null;
          } else {
            const rec = backupId ? await inventory.get(backupId) : (await inventory.list({ targetKind: "tenant", targetId: id, status: "ok", limit: 1 }))[0];
            copia = rec ? { id: rec.id, origen: "primary", estado: rec.status, fecha: new Date(rec.finishedAt ?? rec.startedAt).toISOString(), clave: rec.keyId } : null;
          }
          const alias = opt("--server") ?? (await store.getActiveDatabase(id))?.serverAlias ?? null;
          print({ simulacion: true, empresa: id, origen: source, copia, servidor: alias, baseNueva: restoredDatabaseName(id, Date.now()), conmutar: flag("--switch") });
          console.log("[dry-run] usa --apply para restaurar en una base nueva (y --switch para apuntar el registro a ella)");
          break;
        }
        const rep = await restoreTenant(
          { storage: sourceStorageOrDie(source), ring: backupKeyringFromEnv(process.env), inventory, copies, servers, registry, reader: store },
          { tenantId: id, backupId, source, serverAlias: opt("--server"), switch: flag("--switch"), actor },
        );
        print(rep);
        if (!rep.verification.ok) process.exitCode = 1;
        break;
      }
      case "restore-platform": {
        const kind = (pos[0] ?? die("Falta registry|crm")) as "registry" | "crm";
        if (kind !== "registry" && kind !== "crm") die("Destino no válido: registry o crm");
        const envName = opt("--admin-url-env") ?? die("Falta --admin-url-env <VARIABLE>");
        const adminUrl = process.env[envName] ?? die(`La variable ${envName} no está definida`);
        const database = opt("--database") ?? die("Falta --database <base nueva>");
        if (!flag("--apply")) {
          console.log(`[dry-run] restaurar ${kind} (origen ${source}) en la base NUEVA ${database} (usa --apply)`);
          break;
        }
        const rep = await restorePlatformDatabase(
          { storage: sourceStorageOrDie(source), ring: backupKeyringFromEnv(process.env), inventory, copies },
          { kind, backupId: opt("--backup") ? Number(opt("--backup")) : undefined, source, adminUrl, database, actor: actorLabel },
        );
        print(rep);
        if (!rep.verification.ok) process.exitCode = 1;
        break;
      }
      default:
        die(`Orden desconocida: ${cmd}`);
    }
  } finally {
    await servers?.end();
    await pool.end();
  }
}

/** Reconstrucción total desde un destino de copias a un servidor nuevo (docs/runbooks/RECUPERACION_TOTAL.md). */
async function rebuild(source: BackupDestination) {
  const envName = opt("--admin-url-env") ?? die("Falta --admin-url-env <VARIABLE> (servidor MySQL NUEVO)");
  const adminUrl = process.env[envName] ?? die(`La variable ${envName} no está definida`);
  const cfg = parseDatabaseServers(process.env) ?? die("Falta PROVISIONING_DB_SERVERS o PROVISIONING_DB_ADMIN_URL (servidores nuevos de las empresas)");
  const alias = opt("--server") ?? die("Falta --server <alias del servidor nuevo>");
  const registryDatabase = opt("--registry-db") ?? "es_registry";
  const crmDatabase = opt("--crm-db") ?? null;
  const storage = sourceStorageOrDie(source);
  const ring = backupKeyringFromEnv(process.env);
  keyringFromEnv(process.env); // REGISTRY_KEYS obligatorio: sin él no se puede volver a cifrar el DSN de cada empresa
  const media = flag("--to-media") ? (filesOutOrDie() as MediaTarget) : null;
  if (!flag("--apply")) {
    const pkg = await readRecoveryPackage(storage, ring).catch((e) => die(`Paquete de recuperación ilegible: ${safeError(e)}`));
    print({
      simulacion: true,
      origen: storage.describe(),
      paquete: pkg ? { generatedAt: pkg.generatedAt, empresas: pkg.tenants.map((t) => `${t.id} (${t.status})`) } : null,
      registro: registryDatabase,
      crm: crmDatabase,
      servidorEmpresas: alias,
      ficheros: media ? media.describe() : "no (falta --to-media)",
    });
    console.log("[dry-run] usa --apply para reconstruir (bases NUEVAS; no toca nada existente)");
    return;
  }
  const servers = new DatabaseServers(cfg);
  try {
    const rep = await rebuildPlatform({
      storage,
      source,
      ring,
      registryRing: () => keyringFromEnv(process.env),
      adminUrl,
      registryDatabase,
      crmDatabase,
      servers,
      serverAlias: alias,
      media,
      registryMigrationsDir: path.resolve(process.cwd(), "db/registry"),
      actor,
      only: opt("--only")?.split(",").filter(Boolean),
      log,
    });
    print(rep);
    if (!rep.ok) process.exitCode = 1;
  } finally {
    await servers.end();
  }
}

main().catch((e) => {
  console.error(safeError(e));
  process.exit(1);
});
