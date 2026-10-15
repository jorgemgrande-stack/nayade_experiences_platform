/**
 * Operadores contra MySQL real (opt-in con REGISTRY_TEST_DATABASE_URL; ejecutar en serie):
 * migración idempotente, persistencia de sesiones y bloqueos tras «reiniciar» (pool y servicio
 * nuevos), unicidad y protección concurrente del último superadministrador.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { OperatorAuthService } from "./controlPlane/operatorAuth";
import { MysqlOperatorStore } from "./controlPlane/operatorStore";

const url = process.env.REGISTRY_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const MIGRATION = path.resolve(__dirname, "../db/registry/0007_operators.sql");
const TABLES = "cp_operator_events, cp_password_resets, cp_operator_sessions, cp_operators";
const PW = { root: "Raiz-Segura-Prado-2026!", dos: "Segundo-Pino-Alto-8812", ana: "Ventas-Luna-Sol-4821" };

d("operadores (MySQL)", () => {
  let admin: mysql.Pool;
  const service = (pool: mysql.Pool) => new OperatorAuthService(new MysqlOperatorStore(pool));
  const pool = () => mysql.createPool({ uri: url!, connectionLimit: 4 });

  beforeAll(async () => {
    admin = mysql.createPool({ uri: url!, multipleStatements: true, connectionLimit: 2 });
    await admin.query(`DROP TABLE IF EXISTS ${TABLES}`);
    await admin.query("CREATE TABLE IF NOT EXISTS registry_meta (k VARCHAR(64) PRIMARY KEY, v VARCHAR(255) NOT NULL)");
    await admin.query("INSERT IGNORE INTO registry_meta (k, v) VALUES ('schema_version', '0006')");
    const sql = fs.readFileSync(MIGRATION, "utf8");
    await admin.query(sql);
    await admin.query(sql); // segunda ejecución sin error (idempotente)
  });

  afterAll(async () => {
    await admin?.query(`DROP TABLE IF EXISTS ${TABLES}`);
    await admin?.end();
  });

  it("sesiones y bloqueos persisten tras reiniciar; solo hashes en la BD", async () => {
    const p1 = pool();
    const s1 = service(p1);
    await s1.bootstrap({ username: "root", displayName: "Raíz", password: PW.root });
    await expect(s1.bootstrap({ username: "otro", displayName: "Otro", password: PW.dos })).rejects.toMatchObject({ code: "already_initialized" });
    const root = { id: 1, username: "root", role: "superadmin" as const };
    await s1.create(root, { username: "ana", email: "ana@elephant.test", displayName: "Ana", role: "sales", password: PW.ana });
    await expect(s1.create(root, { username: "ANA", displayName: "Ana 2", role: "sales", password: PW.ana })).rejects.toMatchObject({ code: "conflict" });
    await expect(s1.create(root, { username: "ana2", email: "ana@elephant.test", displayName: "Ana 2", role: "sales", password: PW.ana })).rejects.toMatchObject({ code: "conflict" });
    const { token } = await s1.login("root", PW.root, { ip: "127.0.0.1", userAgent: "vitest" });
    for (let i = 0; i < 5; i++) await s1.login("ana", `mala-${i}-xxxxxxxx`).catch(() => undefined);
    await p1.end();

    // «Reinicio»: pool y servicio nuevos sobre la misma BD
    const p2 = pool();
    const s2 = service(p2);
    const v = await s2.validateSession(token);
    expect(v?.operator.username).toBe("root");
    await expect(s2.login("ana", PW.ana)).rejects.toMatchObject({ code: "account_locked" });

    const [rows] = await admin.query<any[]>("SELECT * FROM cp_operator_sessions");
    const dump = JSON.stringify(rows) + JSON.stringify((await admin.query("SELECT * FROM cp_operators"))[0]);
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(PW.root);
    expect(rows[0].id).toMatch(/^[a-f0-9]{64}$/);

    await s2.logout(v!.session, v!.operator);
    expect(await s2.validateSession(token)).toBeNull();
    const events = await s2.events(undefined, 50);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["operator_created", "login_success", "account_locked", "logout"]));
    expect(JSON.stringify(events)).not.toContain(PW.ana);
    await p2.end();
  });

  it("dos bajas simultáneas no dejan la instalación sin superadministradores", async () => {
    const p = pool();
    const s = service(p);
    const root = { id: 1, username: "root", role: "superadmin" as const };
    const dos = await s.create(root, { username: "dos", displayName: "Segundo", role: "superadmin", password: PW.dos });
    const actor = { id: 999, username: "externo", role: "superadmin" as const };
    const results = await Promise.allSettled([s.update(actor, 1, { status: "disabled" }), s.update(actor, dos.id, { status: "disabled" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "last_superadmin" } });
    const [rows] = await admin.query<any[]>("SELECT COUNT(*) AS n FROM cp_operators WHERE role = 'superadmin' AND status = 'active'");
    expect(Number(rows[0].n)).toBe(1);
    await p.end();
  });
});
