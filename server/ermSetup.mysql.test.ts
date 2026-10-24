/**
 * Base de medición del Resource Manager (`es_erm`) con MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL): creación
 * idempotente, permisos mínimos del usuario `es_erm`, sonda sin restos y negativa ante permisos de más.
 * Usa la base y el usuario reales `es_erm` del servidor de pruebas y los borra al terminar.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { grantsState, runErmSetup } from "./_core/erm/setup";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe("grantsState (lógica pura)", () => {
  it("exactamente SELECT, INSERT y UPDATE sobre es_erm.usage_hourly", () => {
    expect(grantsState(["GRANT USAGE ON *.* TO `es_erm`@`%`", "GRANT SELECT, INSERT, UPDATE ON `es_erm`.`usage_hourly` TO `es_erm`@`%`"])).toBe("ok");
    expect(grantsState(["GRANT USAGE ON *.* TO `es_erm`@`%`"])).toBe("missing");
    expect(grantsState(["GRANT SELECT, INSERT, UPDATE, DELETE ON `es_erm`.`usage_hourly` TO `es_erm`@`%`"])).toBe("excess");
    expect(grantsState(["GRANT SELECT ON `es_registry`.* TO `es_erm`@`%`", "GRANT SELECT, INSERT, UPDATE ON `es_erm`.`usage_hourly` TO `es_erm`@`%`"])).toBe("excess");
  });
});

describe.skipIf(!URL_)("erm-setup con MySQL real", () => {
  let admin: mysql.Pool;
  const u = new URL(URL_ ?? "mysql://x@127.0.0.1:3306/x");
  const password = crypto.randomBytes(24).toString("base64url");
  const clean = async () => {
    await admin.query("DROP USER IF EXISTS 'es_erm'@'%'");
    await admin.query("DROP DATABASE IF EXISTS es_erm");
  };
  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await clean();
  });
  afterAll(async () => {
    await clean();
    await admin.end();
  });
  const run = (apply: boolean, pw = password) => runErmSetup({ admin, host: u.hostname, port: Number(u.port || 3306), password: pw, apply });

  it("simulación sin tocar nada", async () => {
    expect(await run(false)).toEqual({ database: "would_create", table: "would_create", user: "would_create", grants: "would_apply", probe: null });
    const [d] = await admin.query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'es_erm'");
    expect(d.length).toBe(0);
  });

  it("crea base, tabla y usuario con permisos mínimos; la sonda no deja restos", async () => {
    const r = await run(true);
    expect(r).toMatchObject({ database: "created", table: "created", user: "created", grants: "applied" });
    expect(r.probe).toEqual({ write: true, deleteDenied: true, ddlDenied: true, otherDbDenied: true });
    const [rows] = await admin.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM es_erm.usage_hourly");
    expect(Number(rows[0].n)).toBe(0);
  });

  it("idempotente: una segunda ejecución no cambia nada y la sonda sigue en verde", async () => {
    const r = await run(true);
    expect(r).toMatchObject({ database: "exists", table: "exists", user: "exists", grants: "ok" });
    expect(r.probe?.write).toBe(true);
    const dry = await run(false);
    expect(dry).toMatchObject({ database: "exists", table: "exists", user: "exists", grants: "ok" });
    // La sonda no cuenta como consumo de ninguna empresa
    expect(dry.last24h).toEqual([]);
  });

  it("simulación con consumo real: agregado por empresa de las últimas 24 h, sin detalle", async () => {
    await admin.query(
      "INSERT INTO es_erm.usage_hourly (tenant_id, metric, hour_start, quantity) VALUES ('t-a', 'http.request', NOW(), 5), ('t-a', 'email.sent', NOW(), 1), ('t-b', 'http.request', NOW() - INTERVAL 30 HOUR, 9)",
    );
    const r = await run(false);
    expect(r.last24h?.map((x) => [x.tenant, x.metrics, x.rows])).toEqual([["t-a", 2, 2]]);
    await admin.query("DELETE FROM es_erm.usage_hourly");
  });

  it("sin contraseña o con una corta no aplica nada", async () => {
    await expect(run(true, "")).rejects.toThrow(/ES_ERM_PASSWORD/);
    await expect(run(true, "corta")).rejects.toThrow(/ES_ERM_PASSWORD/);
  });

  it("con permisos de más no los toca y lo marca (lo decide una persona)", async () => {
    await admin.query("GRANT DELETE ON es_erm.usage_hourly TO 'es_erm'@'%'");
    const r = await run(true);
    expect(r).toMatchObject({ grants: "excess", probe: null });
    await admin.query("REVOKE DELETE ON es_erm.usage_hourly FROM 'es_erm'@'%'");
    expect((await run(false)).grants).toBe("ok");
  });
});
