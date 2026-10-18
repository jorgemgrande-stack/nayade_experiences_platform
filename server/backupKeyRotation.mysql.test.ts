/**
 * Rotación de la clave de copias (bk1 → bk2) con MySQL real (opt-in): el trabajo de copia y la
 * restauración del CRM aceptan las dos claves; la copia antigua se sigue restaurando y verificando;
 * sin bk1 la copia antigua se rechaza ANTES de crear ninguna base; la reversión (bk1 activa con bk2 en
 * el llavero) mantiene todo restaurable. Procedimiento: docs/runbooks/ROTACION_CLAVE_COPIAS.md.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:…@127.0.0.1:3432/registry_test pnpm vitest run server/backupKeyRotation.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { backupKeyringFromEnv, readHeader } from "./_core/ops/backupCrypto";
import { FsBackupStorage } from "./_core/ops/backupStorage";
import { MemoryBackupInventory } from "./_core/ops/backupInventory";
import { runBackupJob } from "./_core/ops/backupJob";
import { restorePlatformDatabase } from "./_core/ops/backupRestore";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

describe.skipIf(!URL_)("rotación de la clave de copias con MySQL real", () => {
  const run = crypto.randomBytes(3).toString("hex");
  const CRM = `rotcrm_${run}`;
  const created: string[] = [CRM];
  const K1 = crypto.randomBytes(32).toString("base64");
  const K2 = crypto.randomBytes(32).toString("base64");
  const ringOf = (keys: string, active: string) => backupKeyringFromEnv({ BACKUP_KEYS: keys, BACKUP_ACTIVE_KEY_ID: active } as NodeJS.ProcessEnv);
  const before = ringOf(`bk1:${K1}`, "bk1");
  const rotated = ringOf(`bk1:${K1},bk2:${K2}`, "bk2");
  const onlyNew = ringOf(`bk2:${K2}`, "bk2");
  const reverted = ringOf(`bk1:${K1},bk2:${K2}`, "bk1");
  const reader = { listTenants: async () => [], getActiveDatabase: async () => null };

  let admin: mysql.Connection;
  let work: string;
  let storage: FsBackupStorage;
  const inventory = new MemoryBackupInventory();
  const copyIds: Record<string, number> = {};

  const backup = async (ring: typeof before, label: string) => {
    const rep = await runBackupJob({ reader, tenantDsn: async () => null, crmDsn: withDb(URL_!, CRM), storage, ring, inventory, tmpDir: work });
    const crm = rep.results.find((r) => r.kind === "crm")!;
    expect(crm.status).toBe("ok");
    copyIds[label] = crm.inventoryId!;
    return rep;
  };
  const restore = async (ring: typeof before, label: string, database: string) => {
    created.push(database);
    return restorePlatformDatabase({ storage, ring, inventory }, { kind: "crm", backupId: copyIds[label], adminUrl: URL_!, database, tmpDir: work });
  };
  const exists = async (db: string) => {
    const [r] = await admin.query<mysql.RowDataPacket[]>("SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [db]);
    return r.length > 0;
  };

  beforeAll(async () => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "es-rot-"));
    storage = new FsBackupStorage(path.join(work, "store"));
    admin = await mysql.createConnection({ uri: URL_!, multipleStatements: true });
    await admin.query(`CREATE DATABASE \`${CRM}\``);
    await admin.query(
      `USE \`${CRM}\`;
       CREATE TABLE companies (id INT PRIMARY KEY, name VARCHAR(80) NOT NULL);
       CREATE TABLE orders (id INT PRIMARY KEY, company_id INT NOT NULL, total_cents INT NOT NULL, note VARCHAR(40) NULL);
       CREATE TRIGGER orders_note BEFORE INSERT ON orders FOR EACH ROW SET NEW.note = COALESCE(NEW.note, 'auto');
       INSERT INTO companies VALUES (1, 'Ñandú S.L.'), (2, 'Acme');
       INSERT INTO orders (id, company_id, total_cents) VALUES (1, 1, 2900), (2, 2, 7900), (3, 1, 27900);`,
    );
  }, 120_000);

  afterAll(async () => {
    if (admin) {
      for (const db of created) await admin.query(`DROP DATABASE IF EXISTS \`${db}\``).catch(() => undefined);
      await admin.end();
    }
    if (work) fs.rmSync(work, { recursive: true, force: true });
  });

  it("antes de rotar: la copia se cifra con bk1", async () => {
    const rep = await backup(before, "old");
    expect(rep.keyId).toBe("bk1");
    const row = (await inventory.list({ limit: 10 })).find((r) => r.id === copyIds.old)!;
    expect(row.keyId).toBe("bk1");
    expect(readHeader(path.join(work, "store", ...row.location!.split("/"))).keyId).toBe("bk1");
  }, 120_000);

  it("tras rotar: la copia nueva se cifra con bk2 y la antigua sigue intacta", async () => {
    await admin.query(`INSERT INTO \`${CRM}\`.orders (id, company_id, total_cents) VALUES (4, 2, 75900)`);
    const rep = await backup(rotated, "new");
    expect(rep.keyId).toBe("bk2");
    const rows = await inventory.list({ limit: 10 });
    expect(rows.find((r) => r.id === copyIds.new)!.keyId).toBe("bk2");
    expect(rows.find((r) => r.id === copyIds.old)!.keyId).toBe("bk1");
  }, 120_000);

  it("con bk1 y bk2: se restauran y verifican la copia antigua (bk1) y la nueva (bk2), sin tocar el original", async () => {
    const [[sumBefore]] = await admin.query<mysql.RowDataPacket[]>(`CHECKSUM TABLE \`${CRM}\`.orders`);
    const old = await restore(rotated, "old", `rotcrm_ro_${run}`);
    expect(old.verification).toMatchObject({ ok: true, tables: 2, rows: 5 });
    expect(old.backup.keyId).toBe("bk1");
    const fresh = await restore(rotated, "new", `rotcrm_rn_${run}`);
    expect(fresh.verification).toMatchObject({ ok: true, tables: 2, rows: 6 });
    expect(fresh.backup.keyId).toBe("bk2");
    const [n] = await admin.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n, SUM(total_cents) AS s FROM \`rotcrm_rn_${run}\`.orders`);
    expect(n[0]).toMatchObject({ n: 4, s: "114600" });
    const [t] = await admin.query<mysql.RowDataPacket[]>("SELECT TRIGGER_NAME AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?", [`rotcrm_rn_${run}`]);
    expect(t.map((r) => r.n)).toEqual(["orders_note"]);
    const [[sumAfter]] = await admin.query<mysql.RowDataPacket[]>(`CHECKSUM TABLE \`${CRM}\`.orders`);
    expect(sumAfter.Checksum).toBe(sumBefore.Checksum);
  }, 120_000);

  it("sin bk1: la copia antigua se rechaza antes de crear la base; la nueva sí se restaura", async () => {
    const target = `rotcrm_nok_${run}`;
    await expect(restore(onlyNew, "old", target)).rejects.toThrow(/bk1/);
    expect(await exists(target)).toBe(false);
    expect((await restore(onlyNew, "new", `rotcrm_nn_${run}`)).verification.ok).toBe(true);
  }, 120_000);

  it("reversión (bk1 activa, bk2 conservada): lo nuevo vuelve a bk1 y las tres copias se restauran", async () => {
    const rep = await backup(reverted, "back");
    expect(rep.keyId).toBe("bk1");
    for (const [label, db] of [["old", `rotcrm_v1_${run}`], ["new", `rotcrm_v2_${run}`], ["back", `rotcrm_v3_${run}`]] as const) {
      expect((await restore(reverted, label, db)).verification.ok).toBe(true);
    }
  }, 120_000);
});
