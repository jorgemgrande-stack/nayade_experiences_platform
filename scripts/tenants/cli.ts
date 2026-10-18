/**
 * CLI de operador del registro de tenants.
 *
 *   pnpm exec tsx scripts/tenants/cli.ts list
 *   pnpm exec tsx scripts/tenants/cli.ts show <tenant>
 *   pnpm exec tsx scripts/tenants/cli.ts events <tenant> [--limit 50]
 *   pnpm exec tsx scripts/tenants/cli.ts create <tenant> "<nombre>"               [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts status <tenant> <estado> --reason "..."  [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts domain-add <tenant> <dominio> [--kind custom|platform_subdomain] [--primary] [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts domain-verify <dominio> --target <host-plataforma> [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts domain-activate <dominio>                [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts domain-disable <dominio> --reason "..."  [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts db-register <tenant> --dsn-env VAR       [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts db-activate <tenant> <idBD>              [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts rotate-keys                              [--apply]   (DSN y secretos TOTP de operadores)
 *   pnpm exec tsx scripts/tenants/cli.ts provision <tenant> --name "Nombre" --admin-email a@b.c --domain elephantsource.es
 *        [--modules hotel,spa] [--trial-days 15] [--server <alias>] [--apply]
 *        (PROVISIONING_DB_SERVERS, o PROVISIONING_DB_ADMIN_URL + PROVISIONING_DB_HOST[/PORT] para un único servidor)
 *   pnpm exec tsx scripts/tenants/cli.ts provision-status <tenant>
 *   pnpm exec tsx scripts/tenants/cli.ts provision-abort <tenant> --reason "..." [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts migrate-all [--only a,b] [--apply]     (dry-run por defecto; canario primero)
 *   pnpm exec tsx scripts/tenants/cli.ts diagnose <tenant>
 *   pnpm exec tsx scripts/tenants/cli.ts backup <tenant> --out <dir>          (copia manual sin cifrar; la programada: server/controlPlane/backupJob.ts)
 *   pnpm exec tsx scripts/tenants/cli.ts backup-verify <manifest.json> --scratch-dsn-env VAR   (BD de pruebas prescindible)
 *   pnpm exec tsx scripts/tenants/cli.ts incidents [--status open|acknowledged|resolved]
 *   pnpm exec tsx scripts/tenants/cli.ts alerts-run                       (evalúa reglas y abre/cierra incidencias)
 *   pnpm exec tsx scripts/tenants/cli.ts retention [--backups <dir>] [--apply]   (ERM_DATABASE_URL para uso)
 *   pnpm exec tsx scripts/tenants/cli.ts quotas <tenant>
 *   pnpm exec tsx scripts/tenants/cli.ts quota-set <tenant> <metrica> <minute|hour|day|month> <limite> [--soft] [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts quota-remove <tenant> <metrica> <periodo> [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts usage <tenant> [--days 30] [--csv]   (requiere ERM_DATABASE_URL)
 *   pnpm exec tsx scripts/tenants/cli.ts entitlements <tenant>
 *   pnpm exec tsx scripts/tenants/cli.ts entitlement-grant <tenant> <modulo> [--until 2027-01-31] [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts entitlement-status <tenant> <modulo> <active|suspended|expired> [--apply]
 *   pnpm exec tsx scripts/tenants/cli.ts entitlement-revoke <tenant> <modulo> [--apply]
 *
 * Conexión: REGISTRY_ADMIN_DATABASE_URL (usuario de escritura; nunca se imprime) y
 * REGISTRY_KEYS / REGISTRY_ACTIVE_KEY_ID. El DSN de una BD se pasa SIEMPRE por variable de
 * entorno (`--dsn-env`), nunca como argumento, para que no quede en el historial del shell.
 *
 * Garantías: las órdenes de escritura son *dry-run* salvo `--apply`; las salidas no contienen
 * DSN ni credenciales (solo identificadores, estados y huellas de clave).
 */
import mysql from "mysql2/promise";
import { keyringFromEnv } from "../../server/_core/tenantRegistry/crypto";
import { rotateOperatorMfaKeys } from "../../server/controlPlane/operatorMfaKeys";
import { MysqlTenantRegistryStore } from "../../server/_core/tenantRegistry/mysqlStore";
import { TenantRegistryService, type Actor } from "../../server/_core/tenantRegistry/service";
import { verifyDomainOwnership } from "../../server/_core/tenantRegistry/domainVerification";
import type { TenantStatus } from "../../server/_core/tenantRegistry/contract";
import { EntitlementAdmin } from "../../server/_core/modules/mysqlEntitlements";
import { QuotaAdmin } from "../../server/_core/erm/mysqlQuotas";
import path from "node:path";
import { IncidentService, MysqlIncidentStore, webhookNotifier } from "../../server/_core/ops/incidents";
import { runAlerts } from "../../server/_core/ops/alerts";
import { runRetention, scanBackups } from "../../server/_core/ops/retention";
import { migrateAllTenants } from "../../server/_core/ops/tenantMigrations";
import { diagnoseTenant } from "../../server/_core/ops/diagnostics";
import { backupDatabase, verifyBackup } from "../../server/_core/ops/backup";
import { ProvisioningService } from "../../server/_core/provisioning/service";
import {
  MysqlProvisioningStore,
  MysqlSchemaApplier,
  MysqlTenantSeeder,
} from "../../server/_core/provisioning/mysqlAdapters";
import { DatabaseServers, MultiServerDatabaseProvisioner, parseDatabaseServers, registryServerUsage } from "../../server/_core/provisioning/servers";
import { MysqlBackupInventory } from "../../server/_core/ops/backupInventory";
import { MysqlUsageStore } from "../../server/_core/erm/usage";
import type { QuotaPeriod } from "../../server/_core/erm/types";
import type { EntitlementStatus } from "../../server/_core/modules/entitlements";

const args = process.argv.slice(2);
const cmd = args[0];
const BOOLEAN_FLAGS = new Set(["--apply", "--primary"]);
const pos: string[] = [];
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    if (!BOOLEAN_FLAGS.has(args[i])) i++;
  } else pos.push(args[i]);
}
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const APPLY = flag("--apply");

const actor: Actor = { type: "operator", id: opt("--actor") ?? process.env.USERNAME ?? process.env.USER ?? "operator" };

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function print(o: unknown) {
  console.log(JSON.stringify(o, null, 2));
}

async function main() {
  if (!cmd || cmd === "help") {
    console.log("Ver la cabecera de scripts/tenants/cli.ts");
    return;
  }
  const url = process.env.REGISTRY_ADMIN_DATABASE_URL;
  if (!url) die("Falta REGISTRY_ADMIN_DATABASE_URL");
  const pool = mysql.createPool({ uri: url, connectionLimit: 2 });
  try {
    const store = new MysqlTenantRegistryStore(pool);
    const ring = keyringFromEnv(process.env);
    const svc = new TenantRegistryService(store, () => ring);

    const write = async (what: string, fn: () => Promise<unknown>) => {
      if (!APPLY) {
        console.log(`[dry-run] ${what} (usa --apply para ejecutar)`);
        return;
      }
      print(await fn());
    };

    switch (cmd) {
      case "list": {
        const ts = await store.listTenants();
        console.table(ts.map((t) => ({ id: t.id, nombre: t.displayName, estado: t.status, version: t.registryVersion, esquema: t.schemaVersion })));
        break;
      }
      case "show": {
        const id = pos[0] ?? die("Falta <tenant>");
        const t = await store.getTenant(id);
        if (!t) die("Tenant no encontrado");
        const dbs = (await store.listDatabases(id)).map((d) => ({ id: d.id, estado: d.state, clave: d.keyId, alias: d.serverAlias }));
        print({ tenant: t, dominios: await store.listDomains(id), bases_de_datos: dbs });
        break;
      }
      case "events": {
        const id = pos[0] ?? die("Falta <tenant>");
        print(await store.listEvents(id, Number(opt("--limit") ?? 50)));
        break;
      }
      case "create": {
        const [id, name] = [pos[0] ?? die("Falta <tenant>"), pos[1] ?? die("Falta <nombre>")];
        await write(`crear tenant ${id}`, () => svc.createTenant({ id, displayName: name }, actor));
        break;
      }
      case "status": {
        const [id, to] = [pos[0] ?? die("Falta <tenant>"), (pos[1] ?? die("Falta <estado>")) as TenantStatus];
        await write(`cambiar ${id} a ${to}`, () => svc.setStatus(id, to, actor, { reason: opt("--reason") }));
        break;
      }
      case "domain-add": {
        const [id, domain] = [pos[0] ?? die("Falta <tenant>"), pos[1] ?? die("Falta <dominio>")];
        const kind = (opt("--kind") ?? "custom") as "custom" | "platform_subdomain";
        await write(`añadir dominio ${domain} a ${id}`, () => svc.addDomain(id, domain, kind, actor, { primary: flag("--primary") }));
        break;
      }
      case "domain-verify": {
        const domain = pos[0] ?? die("Falta <dominio>");
        const target = opt("--target") ?? die("Falta --target <host de plataforma>");
        const r = await store.resolveDomain(domain);
        if (!r?.domain.verificationToken) die("El dominio no existe o no requiere verificación");
        const res = await verifyDomainOwnership({ domain, token: r.domain.verificationToken, platformTarget: target });
        print({ ok: res.ok, cname: res.cname, txt: res.txt, pendiente: res.pending });
        if (res.ok) await write(`marcar ${domain} como verificado`, () => svc.markDomainVerified(domain, actor));
        break;
      }
      case "domain-activate": {
        const domain = pos[0] ?? die("Falta <dominio>");
        await write(`activar dominio ${domain}`, () => svc.activateDomain(domain, actor));
        break;
      }
      case "domain-disable": {
        const domain = pos[0] ?? die("Falta <dominio>");
        await write(`desactivar dominio ${domain}`, () => svc.disableDomain(domain, actor, opt("--reason")));
        break;
      }
      case "db-register": {
        const id = pos[0] ?? die("Falta <tenant>");
        const envName = opt("--dsn-env") ?? die("Falta --dsn-env <VARIABLE> con el DSN mysql://");
        const dsn = process.env[envName] ?? die(`La variable ${envName} no está definida`);
        await write(`registrar BD de ${id} (DSN en ${envName}, no se imprime)`, async () => {
          const ref = await svc.registerDatabase(id, dsn, actor, { serverAlias: opt("--alias") });
          return { id: ref.id, estado: ref.state, clave: ref.keyId };
        });
        break;
      }
      case "db-activate": {
        const [id, dbId] = [pos[0] ?? die("Falta <tenant>"), Number(pos[1] ?? die("Falta <idBD>"))];
        await write(`activar BD ${dbId} de ${id}`, async () => {
          const ref = await svc.activateDatabase(id, dbId, actor);
          return { id: ref.id, estado: ref.state, clave: ref.keyId };
        });
        break;
      }
      case "rotate-keys": {
        // Secretos TOTP de los operadores (0012): también con la clave activa. La simulación los descifra en
        // memoria para detectar antes de escribir los que ya no se pueden recuperar (clave retirada).
        const mfaPlan = await rotateOperatorMfaKeys(pool, ring, { apply: false, actor: `cli:${actor.id}` });
        const fallidos = (r: typeof mfaPlan) => r.failed.map((f) => ({ operador: f.username, clave: f.keyId, motivo: f.reason }));
        if (!APPLY) {
          print({ claveActiva: ring.activeKeyId, mfaOperadores: mfaPlan.supported ? { pendientes: mfaPlan.pending, irrecuperables: fallidos(mfaPlan) } : "sin la migración 0012" });
        }
        await write("re-cifrar credenciales con la clave activa (DSN de empresas y secretos TOTP de operadores)", async () => {
          const mfa = await rotateOperatorMfaKeys(pool, ring, { apply: true, actor: `cli:${actor.id}` });
          return { rotadas: await svc.rotateKeys(actor), mfaOperadores: mfa.supported ? { rotados: mfa.rotated, irrecuperables: fallidos(mfa) } : "sin la migración 0012" };
        });
        if (mfaPlan.failed.length) {
          console.error("Hay secretos TOTP que no se pueden descifrar con REGISTRY_KEYS: NO retires ninguna clave antigua hasta resolverlo.");
          process.exitCode = 1;
        }
        break;
      }
      case "provision":
      case "provision-status":
      case "provision-abort": {
        const id = pos[0] ?? die("Falta <tenant>");
        const serversCfg = parseDatabaseServers(process.env) ?? die("Falta PROVISIONING_DB_SERVERS o PROVISIONING_DB_ADMIN_URL");
        const servers = new DatabaseServers(serversCfg);
        try {
          const prov = new ProvisioningService({
            registry: svc,
            reader: store,
            databases: new MultiServerDatabaseProvisioner(servers, { usage: () => registryServerUsage(pool) }),
            schema: new MysqlSchemaApplier({
              baselinePath: path.resolve(process.cwd(), "db/baseline/0000_baseline.sql"),
              migrationsDir: path.resolve(process.cwd(), "db/migrations"),
            }),
            seeder: new MysqlTenantSeeder(),
            entitlements: new EntitlementAdmin(pool),
            quotas: new QuotaAdmin(pool),
            store: new MysqlProvisioningStore(pool),
          });
          if (cmd === "provision-status") {
            print((await prov.status(id)) ?? "sin alta");
          } else if (cmd === "provision-abort") {
            const reason = opt("--reason") ?? die("Falta --reason");
            await write(`abortar el alta de ${id} (elimina su BD)`, async () => {
              await prov.abort(id, actor, reason);
              return { aborted: id };
            });
          } else {
            const req = {
              tenantId: id,
              displayName: opt("--name") ?? die("Falta --name"),
              adminEmail: opt("--admin-email") ?? die("Falta --admin-email"),
              platformDomain: opt("--domain") ?? die("Falta --domain"),
              modules: (opt("--modules") ?? "").split(",").filter(Boolean),
              trialDays: opt("--trial-days") ? Number(opt("--trial-days")) : undefined,
              serverAlias: opt("--server"),
            };
            await write(`alta de ${id} (BD, esquema, administrador, dominio, licencias)`, async () => {
              // La invitación del administrador se muestra una sola vez en esta salida (no se persiste)
              return prov.run(req, actor);
            });
          }
        } finally {
          await servers.end();
        }
        break;
      }
      case "migrate-all": {
        const schema = new MysqlSchemaApplier({
          baselinePath: path.resolve(process.cwd(), "db/baseline/0000_baseline.sql"),
          migrationsDir: path.resolve(process.cwd(), "db/migrations"),
        });
        const only = opt("--only")?.split(",").filter(Boolean);
        const res = await migrateAllTenants({ reader: store, registry: svc, schema, actor }, { apply: APPLY, only });
        console.table(res.map((r) => ({ tenant: r.tenantId, resultado: r.outcome, pendientes: (r.pending ?? []).length, esquema: r.schemaVersion ?? "", error: r.error ?? "" })));
        if (!APPLY) console.log("[dry-run] usa --apply para migrar");
        if (res.some((r) => r.outcome === "failed")) process.exitCode = 1;
        break;
      }
      case "diagnose": {
        const id = pos[0] ?? die("Falta <tenant>");
        const rep = await diagnoseTenant(
          { reader: store, registry: svc, entitlements: new EntitlementAdmin(pool), quotas: new QuotaAdmin(pool) },
          id,
        );
        print(rep);
        if (!rep.ok) process.exitCode = 1;
        break;
      }
      case "backup": {
        const id = pos[0] ?? die("Falta <tenant>");
        const out = opt("--out") ?? die("Falta --out <directorio>");
        const dsn = (await svc.getActiveDsn(id)) ?? die("El tenant no tiene BD activa");
        const m = await backupDatabase(dsn, { tenantId: id, outDir: path.resolve(out) });
        print({ file: m.file, bytes: m.bytes, tables: Object.keys(m.tables).length, sha256: m.sha256 });
        break;
      }
      case "backup-verify": {
        const manifest = pos[0] ?? die("Falta <manifest.json>");
        const envName = opt("--scratch-dsn-env") ?? die("Falta --scratch-dsn-env <VARIABLE>");
        const scratch = process.env[envName] ?? die(`La variable ${envName} no está definida`);
        const rep = await verifyBackup(scratch, path.resolve(manifest));
        print(rep);
        if (!rep.ok) process.exitCode = 1;
        break;
      }
      case "incidents": {
        const inc = new IncidentService(new MysqlIncidentStore(pool));
        const st = opt("--status") as "open" | "acknowledged" | "resolved" | undefined;
        console.table((await inc.list({ status: st })).map((i) => ({ id: i.id, sev: i.severity, estado: i.status, tenant: i.tenantId ?? "", titulo: i.title, veces: i.occurrences })));
        break;
      }
      case "alerts-run": {
        const inc = new IncidentService(
          new MysqlIncidentStore(pool),
          process.env.CP_ALERT_WEBHOOK ? webhookNotifier(process.env.CP_ALERT_WEBHOOK) : undefined,
        );
        const r = await runAlerts({
          reader: store,
          incidents: inc,
          quotas: new QuotaAdmin(pool),
          entitlements: new EntitlementAdmin(pool),
          // Última copia correcta por empresa (inventario, registro 0010); sin la tabla, la regla no se evalúa
          lastBackupAt: (await pool.query("SELECT 1 FROM backup_inventory LIMIT 0").then(() => true, () => false))
            ? () => new MysqlBackupInventory(pool).lastSuccess("tenant")
            : undefined,
        });
        print({ abiertas: r.raised, resueltas: r.resolved, activas: r.active });
        break;
      }
      case "retention": {
        const backupDir = opt("--backups");
        const usageUrl = process.env.ERM_DATABASE_URL;
        const usagePool = usageUrl ? mysql.createPool({ uri: usageUrl, connectionLimit: 1 }) : undefined;
        try {
          const rep = await runRetention({ backupDir: backupDir ? path.resolve(backupDir) : undefined, usagePool, registryPool: pool }, { apply: APPLY });
          print({ ...rep, copiasEncontradas: backupDir ? scanBackups(path.resolve(backupDir)).length : 0 });
          if (!APPLY) console.log("[dry-run] usa --apply para ejecutar");
        } finally {
          await usagePool?.end();
        }
        break;
      }
      case "quotas": {
        const id = pos[0] ?? die("Falta <tenant>");
        console.table(await new QuotaAdmin(pool).listQuotas(id));
        break;
      }
      case "quota-set": {
        const [id, metric, period, limit] = [
          pos[0] ?? die("Falta <tenant>"),
          pos[1] ?? die("Falta <metrica>"),
          (pos[2] ?? die("Falta <periodo>")) as QuotaPeriod,
          Number(pos[3] ?? die("Falta <limite>")),
        ];
        await write(`cuota ${metric}/${period}=${limit} para ${id}`, () =>
          new QuotaAdmin(pool).set({ tenantId: id, metric, period, limit, enforcement: flag("--soft") ? "soft" : "hard" }, actor),
        );
        break;
      }
      case "quota-remove": {
        const [id, metric, period] = [pos[0] ?? die("Falta <tenant>"), pos[1] ?? die("Falta <metrica>"), (pos[2] ?? die("Falta <periodo>")) as QuotaPeriod];
        await write(`quitar cuota ${metric}/${period} de ${id}`, () => new QuotaAdmin(pool).remove(id, metric, period, actor));
        break;
      }
      case "usage": {
        const id = pos[0] ?? die("Falta <tenant>");
        const eurl = process.env.ERM_DATABASE_URL ?? die("Falta ERM_DATABASE_URL");
        const epool = mysql.createPool({ uri: eurl, connectionLimit: 1 });
        try {
          const days = Number(opt("--days") ?? 30);
          const to = Date.now() + 3_600_000;
          const rows = await new MysqlUsageStore(epool).list(id, to - days * 86_400_000, to);
          if (flag("--csv")) {
            console.log("hour_start,metric,quantity");
            for (const r of rows) console.log(`${new Date(r.hourStart).toISOString()},${r.metric},${r.quantity}`);
          } else {
            const totals = new Map<string, number>();
            for (const r of rows) totals.set(r.metric, (totals.get(r.metric) ?? 0) + r.quantity);
            console.table(Array.from(totals.entries()).map(([metrica, total]) => ({ metrica, total })));
          }
        } finally {
          await epool.end();
        }
        break;
      }
      case "entitlements": {
        const id = pos[0] ?? die("Falta <tenant>");
        print(await new EntitlementAdmin(pool).listEntitlements(id));
        break;
      }
      case "entitlement-grant": {
        const [id, mod] = [pos[0] ?? die("Falta <tenant>"), pos[1] ?? die("Falta <modulo>")];
        const until = opt("--until");
        const validUntil = until ? new Date(until) : null;
        if (validUntil && Number.isNaN(validUntil.getTime())) die("--until no es una fecha válida");
        await write(`conceder ${mod} a ${id}`, () => new EntitlementAdmin(pool).grant(id, mod, actor, { validUntil }));
        break;
      }
      case "entitlement-status": {
        const [id, mod, st] = [pos[0] ?? die("Falta <tenant>"), pos[1] ?? die("Falta <modulo>"), pos[2] ?? die("Falta <estado>")];
        await write(`${mod} de ${id} a ${st}`, () =>
          new EntitlementAdmin(pool).setStatus(id, mod, st as EntitlementStatus, actor),
        );
        break;
      }
      case "entitlement-revoke": {
        const [id, mod] = [pos[0] ?? die("Falta <tenant>"), pos[1] ?? die("Falta <modulo>")];
        await write(`revocar ${mod} de ${id}`, () => new EntitlementAdmin(pool).revoke(id, mod, actor));
        break;
      }
      default:
        die(`Orden desconocida: ${cmd}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : "error");
  process.exit(1);
});
