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
 *   pnpm exec tsx scripts/tenants/cli.ts rotate-keys                              [--apply]
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
import { MysqlTenantRegistryStore } from "../../server/_core/tenantRegistry/mysqlStore";
import { TenantRegistryService, type Actor } from "../../server/_core/tenantRegistry/service";
import { verifyDomainOwnership } from "../../server/_core/tenantRegistry/domainVerification";
import type { TenantStatus } from "../../server/_core/tenantRegistry/contract";
import { EntitlementAdmin } from "../../server/_core/modules/mysqlEntitlements";
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
        await write("re-cifrar credenciales con la clave activa", async () => ({ rotadas: await svc.rotateKeys(actor) }));
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
