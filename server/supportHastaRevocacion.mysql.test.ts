/**
 * Accesos de soporte «hasta revocación» contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD del registro aislada,
 * creada y borrada aquí, migrada hasta la última del registro — sin migración nueva: misma tabla support_grants):
 * concesión sin caducidad fija, listado global con nombre de empresa y última actividad, cierre de una sesión concreta
 * (lo que lee el Core), revocación con responsable y aislamiento entre empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import mysql from "mysql2/promise";
import { migrateRegistry } from "./_core/tenantRegistry/migrate";
import { MysqlSupportReader, SupportAdmin, UNTIL_REVOKED_EXPIRES_AT, grantActive } from "./_core/support/grants";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "registry_support_until_revoked_test";

describe.skipIf(!URL_)("soporte hasta revocación con MySQL real", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: SupportAdmin;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 5, multipleStatements: true });
    const r = await migrateRegistry(pool, path.resolve(__dirname, "../db/registry"), { dryRun: false });
    expect(r.incomplete).toEqual([]);
    await pool.query("INSERT INTO tenants (id, display_name) VALUES ('t-a', 'Empresa A'), ('t-b', 'Empresa B')");
    store = new SupportAdmin(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("concede sin caducidad fija, lista con empresa y actividad, cierra una sesión y revoca con responsable", async () => {
    const g = await store.create({ tenantId: "t-a", operator: "operator:jorge", reason: "Implantación completa", untilRevoked: true, readOnly: false });
    const l = await store.create({ tenantId: "t-b", operator: "operator:ana", reason: "Ticket #44 de prueba", minutes: 30 });
    const back = await new MysqlSupportReader(pool).getGrant(g.id);
    expect(back).toMatchObject({ untilRevoked: true, readOnly: false, expiresAt: UNTIL_REVOKED_EXPIRES_AT });
    expect(grantActive(back!)).toBe(true);
    const [granted] = await pool.query<mysql.RowDataPacket[]>("SELECT details FROM tenant_events WHERE action = 'support.granted' AND tenant_id = 't-a'");
    const gd = typeof granted[0].details === "string" ? JSON.parse(granted[0].details) : granted[0].details;
    expect(gd).toMatchObject({ grantId: g.id, untilRevoked: true, expiresAt: null, grantedBy: "operator:jorge", readOnly: false });

    // Actividad y sesiones (lo que anota el plano de control con la auditoría del Core)
    const sid = "c3".repeat(12);
    const openedAt = Date.now();
    await store.record("t-a", g.operator, "support.entered", { grantId: g.id, session: sid });
    // Un enlace = una sesión: el plano de control ve que ya se abrió (en cualquier réplica)
    expect(await store.sessionEntered("t-a", g.id, sid)).toBe(true);
    expect(await store.sessionEntered("t-a", g.id, "f6".repeat(12))).toBe(false);
    expect(await store.sessionEntered("t-b", g.id, sid)).toBe(false);
    const all = await store.listAllActive();
    expect(all.map((x) => x.id).sort()).toEqual([g.id, l.id].sort());
    const row = all.find((x) => x.id === g.id)!;
    expect(row).toMatchObject({ tenantName: "Empresa A", untilRevoked: true });
    expect(row.lastActivityAt).not.toBeNull();
    expect((await store.listActive("t-b")).map((x) => x.id)).toEqual([l.id]);

    const reader = new MysqlSupportReader(pool);
    expect(await reader.sessionEnded("t-a", g.id, sid, openedAt)).toBe(false);
    // El cierre de OTRA empresa o de otra concesión con el mismo identificador no cuenta
    await store.record("t-b", l.operator, "support.exited", { grantId: l.id, session: sid });
    expect(await reader.sessionEnded("t-a", g.id, sid, openedAt)).toBe(false);
    await store.record("t-a", g.operator, "support.exited", { grantId: g.id, session: sid });
    expect(await reader.sessionEnded("t-a", g.id, sid, openedAt)).toBe(true);
    expect(await reader.sessionEnded("t-a", g.id, "d4".repeat(12), openedAt)).toBe(false);
    // Cerrar la sesión no revoca la autorización
    expect(grantActive((await reader.getGrant(g.id))!)).toBe(true);

    // Revocar: a nombre de quien revoca, una sola vez, y fuera del listado
    await store.revoke(g.id, "operator:ana");
    await store.revoke(g.id, "operator:ana");
    expect(grantActive((await reader.getGrant(g.id))!)).toBe(false);
    const [rev] = await pool.query<mysql.RowDataPacket[]>("SELECT actor_id, details FROM tenant_events WHERE action = 'support.revoked'");
    expect(rev).toHaveLength(1);
    expect(rev[0].actor_id).toBe("operator:ana");
    const rd = typeof rev[0].details === "string" ? JSON.parse(rev[0].details) : rev[0].details;
    expect(rd).toMatchObject({ grantId: g.id, revokedBy: "operator:ana", beneficiary: "operator:jorge", untilRevoked: true });
    expect((await store.listAllActive()).map((x) => x.id)).toEqual([l.id]);
  });
});
