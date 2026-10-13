/**
 * Integración del registro contra MySQL real (opt-in).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:testroot@127.0.0.1:3317/registry_test pnpm vitest run server/tenantRegistry.mysql.test.ts
 *
 * Sin la variable, la suite se omite. Usa una base de datos de pruebas: ¡se vacía!
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { RegistryError } from "./_core/tenantRegistry/contract";
import { MysqlTenantRegistryStore } from "./_core/tenantRegistry/mysqlStore";
import { TenantRegistryService, type Actor } from "./_core/tenantRegistry/service";
import { keyringFromEnv } from "./_core/tenantRegistry/crypto";
import { TenantResolver } from "./_core/tenantRegistry/resolver";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const OP: Actor = { type: "operator", id: "jorge" };
const DSN = "mysql://u:CLAVE-FICTICIA@db.invalid:3306/acme";

describe.skipIf(!URL_)("registro MySQL (integración)", () => {
  let pool: mysql.Pool;
  let store: MysqlTenantRegistryStore;
  let svc: TenantRegistryService;

  beforeAll(async () => {
    pool = mysql.createPool({ uri: URL_!, multipleStatements: true, connectionLimit: 5 });
    await pool.query(
      "DROP TABLE IF EXISTS tenant_events, tenant_databases, tenant_domains, tenants, registry_meta",
    );
    // El script usa triggers: se ejecuta sentencia a sentencia (sin DELIMITER)
    const sql = fs.readFileSync(path.resolve(__dirname, "../db/registry/0000_registry.sql"), "utf8");
    const noComments = sql.replace(/^--.*$/gm, "");
    for (const stmt of noComments.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) {
      await pool.query(stmt);
    }
    store = new MysqlTenantRegistryStore(pool);
    const ring = keyringFromEnv({
      REGISTRY_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`,
      REGISTRY_ACTIVE_KEY_ID: "k1",
    } as any);
    svc = new TenantRegistryService(store, () => ring);
  });

  beforeEach(async () => {
    await pool.query("SET FOREIGN_KEY_CHECKS=0");
    await pool.query("DELETE FROM tenant_domains");
    await pool.query("DELETE FROM tenant_databases");
    await pool.query("DELETE FROM tenants");
    await pool.query("SET FOREIGN_KEY_CHECKS=1");
    // tenant_events es de solo anexado: se conserva (su tenant_id puede quedar huérfano solo en pruebas)
    await pool.query("SET FOREIGN_KEY_CHECKS=0");
    await pool.query("DROP TRIGGER IF EXISTS trg_events_no_delete");
    await pool.query("DELETE FROM tenant_events");
    await pool.query(
      "CREATE TRIGGER trg_events_no_delete BEFORE DELETE ON tenant_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tenant_events es de solo anexado'",
    );
    await pool.query("SET FOREIGN_KEY_CHECKS=1");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("crea tenant, dominio y BD con auditoría; el DSN solo se guarda cifrado", async () => {
    await svc.createTenant({ id: "acme", displayName: "Acme" }, OP);
    await svc.addDomain("acme", "acme.elephantsource.es", "platform_subdomain", OP, { primary: true });
    const db = await svc.registerDatabase("acme", DSN, OP);
    await svc.activateDatabase("acme", db.id, OP);

    const [raw] = await pool.query<mysql.RowDataPacket[]>("SELECT dsn_cipher FROM tenant_databases");
    expect(JSON.stringify(raw)).not.toContain("CLAVE-FICTICIA");
    expect(await svc.getActiveDsn("acme")).toBe(DSN);

    const ev = await store.listEvents("acme");
    expect(ev.map((e) => e.action)).toEqual(
      expect.arrayContaining(["tenant.created", "domain.added", "database.registered"]),
    );
    expect(JSON.stringify(ev)).not.toContain("CLAVE-FICTICIA");
  });

  it("un dominio no puede pertenecer a dos tenants", async () => {
    await svc.createTenant({ id: "a", displayName: "A" }, OP);
    await svc.createTenant({ id: "b", displayName: "B" }, OP);
    await svc.addDomain("a", "x.elephantsource.es", "platform_subdomain", OP);
    await expect(svc.addDomain("b", "x.elephantsource.es", "platform_subdomain", OP)).rejects.toThrow(RegistryError);
  });

  it("la base de datos impone un único dominio primario y una única BD activa por tenant", async () => {
    await svc.createTenant({ id: "a", displayName: "A" }, OP);
    await pool.query(
      "INSERT INTO tenant_domains (domain, tenant_id, kind, status, is_primary) VALUES ('p1.es','a','custom','active',1)",
    );
    await expect(
      pool.query(
        "INSERT INTO tenant_domains (domain, tenant_id, kind, status, is_primary) VALUES ('p2.es','a','custom','active',1)",
      ),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });

    await pool.query("INSERT INTO tenant_databases (tenant_id,state,dsn_cipher,key_id) VALUES ('a','active','c','k1')");
    await expect(
      pool.query("INSERT INTO tenant_databases (tenant_id,state,dsn_cipher,key_id) VALUES ('a','active','c','k1')"),
    ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
  });

  it("cambiar la BD activa retira la anterior sin dejar dos activas", async () => {
    await svc.createTenant({ id: "a", displayName: "A" }, OP);
    const d1 = await svc.registerDatabase("a", DSN, OP);
    await svc.activateDatabase("a", d1.id, OP);
    const d2 = await svc.registerDatabase("a", DSN.replace("acme", "acme2"), OP);
    await svc.activateDatabase("a", d2.id, OP);
    const all = await store.listDatabases("a");
    expect(all.filter((d) => d.state === "active").map((d) => d.id)).toEqual([d2.id]);
    expect(all.find((d) => d.id === d1.id)!.state).toBe("retired");
  });

  it("concurrencia optimista: la segunda escritura con versión antigua falla", async () => {
    await svc.createTenant({ id: "a", displayName: "A" }, OP);
    const t = (await store.getTenant("a"))!;
    await store.transaction((tx) => tx.updateTenant("a", t.registryVersion, { displayName: "A1" }));
    await expect(
      store.transaction((tx) => tx.updateTenant("a", t.registryVersion, { displayName: "A2" })),
    ).rejects.toMatchObject({ code: "stale_version" });
    expect((await store.getTenant("a"))!.displayName).toBe("A1");
  });

  it("la transacción es atómica: un fallo revierte tenant, dominio y evento", async () => {
    await expect(
      store.transaction(async (tx) => {
        await tx.insertTenant({
          id: "tmp", displayName: "T", status: "provisioning", statusReason: null, baselineVersion: null, schemaVersion: null,
        });
        throw new Error("fallo simulado");
      }),
    ).rejects.toThrow("fallo simulado");
    expect(await store.getTenant("tmp")).toBeNull();
  });

  it("tenant_events es de solo anexado", async () => {
    await svc.createTenant({ id: "a", displayName: "A" }, OP);
    await expect(pool.query("UPDATE tenant_events SET action='x'")).rejects.toThrow(/solo anexado/);
    await expect(pool.query("DELETE FROM tenant_events")).rejects.toThrow(/solo anexado/);
  });

  it("rechaza dominios en mayúsculas y ids de tenant no válidos a nivel de base de datos", async () => {
    await expect(
      pool.query("INSERT INTO tenants (id, display_name) VALUES ('../x','x')"),
    ).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO tenants (id, display_name) VALUES ('ACME','x')"),
    ).rejects.toThrow();
    await svc.createTenant({ id: "a", displayName: "A" }, OP);
    await expect(
      pool.query("INSERT INTO tenant_domains (domain, tenant_id, kind) VALUES ('MAYUS.es','a','custom')"),
    ).rejects.toThrow();
  });

  it("el resolutor sobre MySQL: solo sirve dominios activos y nunca uno desconocido", async () => {
    await svc.createTenant({ id: "acme", displayName: "Acme" }, OP);
    await svc.setStatus("acme", "trial", OP);
    await svc.addDomain("acme", "acme.elephantsource.es", "platform_subdomain", OP);
    const resolver = new TenantResolver(store);

    expect((await resolver.resolveHost("acme.elephantsource.es")).kind).toBe("unknown_domain"); // verificado, no activo
    await svc.activateDomain("acme.elephantsource.es", OP);
    resolver.invalidateAll();
    const ok = await resolver.resolveHost("acme.elephantsource.es");
    expect(ok.kind).toBe("resolved");
    if (ok.kind === "resolved") expect(ok.tenant.tenantId).toBe("acme");
    expect((await resolver.resolveHost("otro.elephantsource.es")).kind).toBe("unknown_domain");
  });
});
