/**
 * Copias de seguridad de Elephant Source: trabajo programable y órdenes de operación.
 * Se empaqueta con `pnpm build:cp` en `dist-cp/backup-job.js` (misma imagen que el plano de control).
 *
 *   node dist-cp/backup-job.js run [--only a,b] [--no-platform]      copia todas las empresas + registro + CRM
 *   node dist-cp/backup-job.js list [--tenant id] [--kind tenant|registry|crm|files] [--limit 50]
 *   node dist-cp/backup-job.js objects <prefijo>                      objetos del almacenamiento (sin registro)
 *   node dist-cp/backup-job.js retention [--apply]                    retención 30/12/12 (BACKUP_KEEP_*)
 *   node dist-cp/backup-job.js restore-tenant <empresa> [--backup <id>] [--server <alias>] [--apply] [--switch]
 *   node dist-cp/backup-job.js restore-platform <registry|crm> --admin-url-env VAR --database <nueva>
 *        [--backup <id> | --manifest <clave>] [--apply]
 *   node dist-cp/backup-job.js restore-files <empresa> --out <directorio>
 *   node dist-cp/backup-job.js migrate-tenants [--only a,b] [--apply]   carril de la app en cada empresa (red privada)
 *
 * (en desarrollo: `pnpm exec tsx server/controlPlane/backupJob.ts <orden>`)
 *
 * Variables: REGISTRY_ADMIN_DATABASE_URL, REGISTRY_KEYS/REGISTRY_ACTIVE_KEY_ID (DSN de las empresas),
 * BACKUP_KEYS/BACKUP_ACTIVE_KEY_ID (cifrado de copias), BACKUP_STORAGE + BACKUP_S3_* o BACKUP_FS_DIR,
 * CRM_DATABASE_URL (opcional), BACKUP_MEDIA=1 + S3_* (ficheros, opcional), BACKUP_APPLY_RETENTION=1
 * (retención tras cada copia), PROVISIONING_DB_SERVERS / PROVISIONING_DB_ADMIN_URL (restauración).
 *
 * Garantías: las restauraciones son simulación salvo `--apply`; solo `--switch` apunta el registro a la
 * base restaurada. Las salidas no contienen DSN, contraseñas ni claves (solo identificadores y huellas).
 */
import path from "node:path";
import mysql from "mysql2/promise";
import { keyringFromEnv } from "../_core/tenantRegistry/crypto";
import { MysqlTenantRegistryStore } from "../_core/tenantRegistry/mysqlStore";
import { TenantRegistryService, type Actor } from "../_core/tenantRegistry/service";
import { backupKeyringFromEnv } from "../_core/ops/backupCrypto";
import { backupStorageFromEnv, mediaSourceFromEnv, type BackupStorage } from "../_core/ops/backupStorage";
import { MysqlBackupInventory, safeError, type BackupTargetKind } from "../_core/ops/backupInventory";
import { restoreTenantFiles, runBackupJob } from "../_core/ops/backupJob";
import { applyBackupRetention, gfsPolicyFromEnv } from "../_core/ops/backupRetention";
import { restorePlatformDatabase, restoreTenant, restoredDatabaseName } from "../_core/ops/backupRestore";
import { DatabaseServers, parseDatabaseServers } from "../_core/provisioning/servers";
import { MysqlSchemaApplier } from "../_core/provisioning/mysqlAdapters";
import { migrateAllTenants } from "../_core/ops/tenantMigrations";

const args = process.argv.slice(2);
const cmd = args[0] && !args[0].startsWith("--") ? args[0] : "run";
const BOOLEAN_FLAGS = new Set(["--apply", "--switch", "--no-platform"]);
const pos: string[] = [];
for (let i = args[0] === cmd ? 1 : 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    if (!BOOLEAN_FLAGS.has(args[i])) i++;
  } else pos.push(args[i]);
}
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const actor: Actor = { type: "operator", id: opt("--actor") ?? process.env.USERNAME ?? process.env.USER ?? "backup-job" };

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

async function main() {
  const regUrl = process.env.REGISTRY_ADMIN_DATABASE_URL;
  // `objects` y `restore-files` funcionan sin registro (recuperación ante desastre)
  if (cmd === "objects") {
    const prefix = pos[0] ?? "";
    for (const o of await storageOrDie().list(prefix)) console.log(`${o.bytes}\t${o.key}`);
    return;
  }
  if (cmd === "restore-files") {
    const id = pos[0] ?? die("Falta <empresa>");
    const out = opt("--out") ?? die("Falta --out <directorio>");
    print(await restoreTenantFiles({ storage: storageOrDie(), ring: backupKeyringFromEnv(process.env) }, id, path.resolve(out)));
    return;
  }
  if (cmd === "restore-platform" && opt("--manifest")) {
    // Sin registro: restaurar el propio registro (o el CRM) a partir del manifiesto
    const kind = (pos[0] ?? die("Falta registry|crm")) as "registry" | "crm";
    if (kind !== "registry" && kind !== "crm") die("Destino no válido: registry o crm");
    const envName = opt("--admin-url-env") ?? die("Falta --admin-url-env <VARIABLE>");
    const adminUrl = process.env[envName] ?? die(`La variable ${envName} no está definida`);
    const database = opt("--database") ?? die("Falta --database <base nueva>");
    if (!flag("--apply")) return void console.log(`[dry-run] restaurar ${kind} (${opt("--manifest")}) en la base NUEVA ${database} (usa --apply)`);
    const rep = await restorePlatformDatabase({ storage: storageOrDie(), ring: backupKeyringFromEnv(process.env) }, { kind, manifestKey: opt("--manifest")!, adminUrl, database });
    print(rep);
    if (!rep.verification.ok) process.exitCode = 1;
    return;
  }

  if (!regUrl) die("Falta REGISTRY_ADMIN_DATABASE_URL");
  const pool = mysql.createPool({ uri: regUrl, connectionLimit: 3 });
  const servers = (() => {
    const cfg = parseDatabaseServers(process.env);
    return cfg ? new DatabaseServers(cfg) : null;
  })();
  try {
    const store = new MysqlTenantRegistryStore(pool);
    const inventory = new MysqlBackupInventory(pool);
    const registry = new TenantRegistryService(store, () => keyringFromEnv(process.env));

    switch (cmd) {
      case "run": {
        const storage = storageOrDie();
        const ring = backupKeyringFromEnv(process.env);
        const media = mediaSourceFromEnv(process.env);
        log("run_started", { storage: storage.describe(), keyId: ring.activeKeyId, media: media.media ? media.media.describe() : null, ...(media.media ? {} : { mediaReason: (media as { reason: string }).reason }) });
        const rep = await runBackupJob({
          reader: store,
          tenantDsn: (id) => registry.getActiveDsn(id),
          registryDsn: regUrl,
          crmDsn: process.env.CRM_DATABASE_URL || undefined,
          storage,
          ring,
          inventory,
          media: media.media ?? undefined,
          only: opt("--only")?.split(",").filter(Boolean),
          includePlatform: !flag("--no-platform"),
          log,
        });
        const failed = rep.results.filter((r) => r.status === "failed");
        log("run_finished", {
          runId: rep.runId,
          ok: rep.ok,
          durationMs: rep.finishedAt - rep.startedAt,
          copied: rep.results.filter((r) => r.status === "ok").length,
          failed: failed.length,
          skipped: rep.results.filter((r) => r.status === "skipped").map((r) => r.id),
          bytes: rep.results.reduce((n, r) => n + (r.bytes ?? 0), 0),
        });
        if (process.env.BACKUP_APPLY_RETENTION === "1") {
          const ret = await applyBackupRetention({ inventory, storage }, { apply: true, policy: gfsPolicyFromEnv(process.env) });
          log("retention", { deleted: ret.deleted, errors: ret.errors.length });
        }
        if (!rep.ok) process.exitCode = 1;
        break;
      }
      case "list": {
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
      case "retention": {
        const s = backupStorageFromEnv(process.env);
        const rep = await applyBackupRetention({ inventory, storage: s.storage }, { apply: flag("--apply"), policy: gfsPolicyFromEnv(process.env) });
        print({ ...rep, toDelete: rep.toDelete.length, sample: rep.toDelete.slice(0, 20) });
        if (!flag("--apply")) console.log("[dry-run] usa --apply para borrar");
        if (rep.errors.length) process.exitCode = 1;
        break;
      }
      case "restore-tenant": {
        const id = pos[0] ?? die("Falta <empresa>");
        if (!servers) die("Falta PROVISIONING_DB_SERVERS o PROVISIONING_DB_ADMIN_URL (servidor donde restaurar)");
        const backupId = opt("--backup") ? Number(opt("--backup")) : undefined;
        if (!flag("--apply")) {
          const rec = backupId ? await inventory.get(backupId) : (await inventory.list({ targetKind: "tenant", targetId: id, status: "ok", limit: 1 }))[0];
          const alias = opt("--server") ?? (await store.getActiveDatabase(id))?.serverAlias ?? rec?.serverAlias ?? null;
          print({
            simulacion: true,
            empresa: id,
            copia: rec ? { id: rec.id, estado: rec.status, fecha: new Date(rec.finishedAt ?? rec.startedAt).toISOString(), clave: rec.keyId } : null,
            servidor: alias,
            baseNueva: restoredDatabaseName(id, Date.now()),
            conmutar: flag("--switch"),
          });
          console.log("[dry-run] usa --apply para restaurar en una base nueva (y --switch para apuntar el registro a ella)");
          break;
        }
        const rep = await restoreTenant(
          { storage: storageOrDie(), ring: backupKeyringFromEnv(process.env), inventory, servers, registry, reader: store },
          { tenantId: id, backupId, serverAlias: opt("--server"), switch: flag("--switch"), actor },
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
          console.log(`[dry-run] restaurar ${kind} en la base NUEVA ${database} (usa --apply)`);
          break;
        }
        const rep = await restorePlatformDatabase(
          { storage: storageOrDie(), ring: backupKeyringFromEnv(process.env), inventory },
          { kind, backupId: opt("--backup") ? Number(opt("--backup")) : undefined, adminUrl, database },
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

main().catch((e) => {
  console.error(safeError(e));
  process.exit(1);
});
