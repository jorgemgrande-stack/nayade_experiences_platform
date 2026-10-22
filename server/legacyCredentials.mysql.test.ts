/**
 * Migración de credenciales heredadas contra MySQL real (opt-in con REGISTRY_TEST_DATABASE_URL;
 * contenedor aislado; ejecutar en serie). Crea y borra sus propias tablas system_settings/site_settings.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { applyLegacyEncryption, planLegacyCredentials, rollbackLegacyEncryption } from "./_core/credentials/legacyMigration";
import { decryptLegacy } from "./_core/credentials/legacyFields";
import type { Keyring } from "./_core/credentials/vault";

const url = process.env.REGISTRY_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const ring: Keyring = { keys: new Map([["k1", crypto.randomBytes(32)]]), activeId: "k1" };

d("credenciales heredadas (MySQL)", () => {
  let pool: mysql.Pool;

  beforeAll(async () => {
    pool = mysql.createPool({ uri: url!, connectionLimit: 2 });
    await pool.query("DROP TABLE IF EXISTS legacy_credential_audit, system_settings, site_settings");
    await pool.query("CREATE TABLE system_settings (`key` VARCHAR(100) PRIMARY KEY, `value` TEXT NULL)");
    await pool.query("CREATE TABLE site_settings (`key` VARCHAR(100) PRIMARY KEY, `value` TEXT NULL)");
  });

  afterAll(async () => {
    await pool?.query("DROP TABLE IF EXISTS legacy_credential_audit, system_settings, site_settings");
    await pool?.end();
  });

  it("cifra, audita, es idempotente y revierte con datos reales de BD", async () => {
    await pool.query("INSERT INTO system_settings VALUES ('site_ghl_api_key','pit-AAAA-1111'),('otra','no-tocar')");
    await pool.query("INSERT INTO site_settings VALUES ('ghlInboxToken','tok-BBBB'),('ghlInboxWebhookSecret','')");

    const dry = await applyLegacyEncryption(pool, { ring, actor: "test" });
    expect(dry.summary.encrypted).toBe(2);
    const [still] = await pool.query<mysql.RowDataPacket[]>("SELECT `value` FROM system_settings WHERE `key`='site_ghl_api_key'");
    expect(still[0].value).toBe("pit-AAAA-1111");

    const run = await applyLegacyEncryption(pool, { ring, actor: "test", dryRun: false, persistAudit: true });
    expect(run.summary).toMatchObject({ encrypted: 2, error: 0, conflict: 0 });
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT `key`, `value` FROM system_settings ORDER BY `key`");
    const ghl = rows.find((r) => r.key === "site_ghl_api_key")!.value as string;
    expect(ghl.startsWith("enc:v1:k1:")).toBe(true);
    expect(decryptLegacy(ghl, "system_settings", "site_ghl_api_key", ring)).toBe("pit-AAAA-1111");
    expect(rows.find((r) => r.key === "otra")!.value).toBe("no-tocar"); // fuera de la lista, intacto

    const [audit] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM legacy_credential_audit");
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain("pit-AAAA-1111");

    expect((await applyLegacyEncryption(pool, { ring, actor: "test", dryRun: false })).summary.encrypted).toBe(0);
    expect((await planLegacyCredentials(pool, ring)).filter((p) => p.state === "plaintext")).toHaveLength(0);

    const rb = await rollbackLegacyEncryption(pool, { ring, actor: "test", dryRun: false });
    expect(rb.summary.restored).toBe(2);
    const [back] = await pool.query<mysql.RowDataPacket[]>("SELECT `value` FROM system_settings WHERE `key`='site_ghl_api_key'");
    expect(back[0].value).toBe("pit-AAAA-1111");
  });
});
