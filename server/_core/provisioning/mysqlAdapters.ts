/**
 * Adaptadores MySQL del aprovisionamiento.
 *
 *  - `MysqlDatabaseProvisioner`: BD por tenant + usuario propio con permisos SOLO sobre ella.
 *  - `MysqlSchemaApplier`: baseline + migraciones con el mismo historial que scripts/db/migrate.ts.
 *  - `MysqlTenantSeeder`: administrador inicial (invitación), marca.
 *  - `MysqlProvisioningStore`: estado del alta en el registro (`tenant_provisioning`).
 *
 * Los DSN y contraseñas solo existen en memoria; nunca se registran.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements, validateMigrations } from "../../../scripts/db/migrationLib";
import type { DatabaseProvisioner, ProvisioningStore, SchemaApplier, TenantSeeder } from "./ports";
import type { ProvisioningRecord } from "./types";
import { TENANT_TRIGGERS, createTriggerSql } from "./tenantTriggers";
import { getTemplate, renderTemplateText } from "../templates/catalog";

const TABLE = "__elephant_migrations";
const BASELINE_ID = "0000_baseline";

export function databaseNameFor(tenantId: string, prefix = "es_"): string {
  const name = `${prefix}${tenantId.replace(/-/g, "_")}`;
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(name)) throw new Error("Nombre de base de datos no válido");
  return name;
}

export function userNameFor(tenantId: string): string {
  return `esu_${crypto.createHash("sha256").update(tenantId).digest("hex").slice(0, 16)}`;
}

export class MysqlDatabaseProvisioner implements DatabaseProvisioner {
  constructor(
    private admin: Pick<mysql.Pool, "query">,
    private opts: { host: string; port?: number; alias?: string; dbPrefix?: string; userHost?: string },
  ) {}

  async ensureDatabase(tenantId: string): Promise<{ dsn: string; serverAlias: string }> {
    const db = databaseNameFor(tenantId, this.opts.dbPrefix);
    const user = userNameFor(tenantId);
    const host = this.opts.userHost ?? "%";
    const password = crypto.randomBytes(24).toString("base64url");
    await this.admin.query(`CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await this.admin.query(`CREATE USER IF NOT EXISTS ?@? IDENTIFIED BY ?`, [user, host, password]);
    await this.admin.query(`ALTER USER ?@? IDENTIFIED BY ?`, [user, host, password]);
    await this.admin.query(`GRANT ALL PRIVILEGES ON \`${db}\`.* TO ?@?`, [user, host]);
    const dsn = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${this.opts.host}:${this.opts.port ?? 3306}/${db}`;
    return { dsn, serverAlias: this.opts.alias ?? this.opts.host };
  }

  async ensureTriggers(tenantId: string): Promise<string[]> {
    const db = databaseNameFor(tenantId, this.opts.dbPrefix);
    const created: string[] = [];
    for (const t of TENANT_TRIGGERS) {
      const [exists] = await this.admin.query<mysql.RowDataPacket[]>(
        "SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME = ?",
        [db, t.name],
      );
      if (exists.length) continue;
      await this.admin.query(createTriggerSql(db, t), [userNameFor(tenantId), this.opts.userHost ?? "%"]);
      created.push(t.name);
    }
    return created;
  }

  async dropDatabase(tenantId: string): Promise<void> {
    const db = databaseNameFor(tenantId, this.opts.dbPrefix);
    await this.admin.query(`DROP DATABASE IF EXISTS \`${db}\``);
    await this.admin.query(`DROP USER IF EXISTS ?@?`, [userNameFor(tenantId), this.opts.userHost ?? "%"]);
  }
}

export class MysqlSchemaApplier implements SchemaApplier {
  constructor(private opts: { baselinePath: string; migrationsDir: string }) {}

  /** Migraciones pendientes (sin aplicar nada). Incluye el baseline si la BD está vacía. */
  async plan(dsn: string): Promise<string[]> {
    const { migrations } = loadMigrations(this.opts.migrationsDir);
    const conn = await mysql.createConnection({ uri: dsn });
    try {
      let applied = new Set<string>();
      try {
        const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT id FROM \`${TABLE}\``);
        applied = new Set(rows.map((r) => r.id as string));
      } catch {
        /* sin historial: todo pendiente */
      }
      const pending: string[] = [];
      if (!applied.has(BASELINE_ID)) pending.push(BASELINE_ID);
      for (const m of migrations) if (!applied.has(m.id)) pending.push(m.id);
      return pending;
    } finally {
      await conn.end().catch(() => undefined);
    }
  }

  async apply(dsn: string): Promise<{ baselineVersion: string; schemaVersion: string }> {
    const { migrations, errors } = loadMigrations(this.opts.migrationsDir);
    const problems = [...errors.filter((e) => !/No existe/.test(e)), ...validateMigrations(migrations)];
    if (problems.length) throw new Error(`Migraciones no válidas: ${problems.join("; ")}`);

    const conn = await mysql.createConnection({ uri: dsn, multipleStatements: false });
    try {
      await conn.query(
        `CREATE TABLE IF NOT EXISTS \`${TABLE}\` (
           id VARCHAR(128) NOT NULL PRIMARY KEY,
           checksum CHAR(64) NOT NULL,
           applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
           duration_ms INT NOT NULL DEFAULT 0
         ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      );
      const [lock] = await conn.query<mysql.RowDataPacket[]>("SELECT GET_LOCK('es_provision_schema', 30) AS got");
      if (!lock[0]?.got) throw new Error("No se pudo obtener el bloqueo de esquema");
      try {
        const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT id FROM \`${TABLE}\``);
        const applied = new Set<string>(rows.map((r) => r.id as string));

        if (!applied.has(BASELINE_ID)) {
          const sql = fs.readFileSync(this.opts.baselinePath, "utf8");
          const t0 = Date.now();
          await conn.query("SET FOREIGN_KEY_CHECKS = 0");
          for (const stmt of splitStatements(sql)) await conn.query(stmt);
          await conn.query("SET FOREIGN_KEY_CHECKS = 1");
          await conn.query(`INSERT INTO \`${TABLE}\` (id, checksum, duration_ms) VALUES (?,?,?)`, [
            BASELINE_ID,
            crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n").trim()).digest("hex"),
            Date.now() - t0,
          ]);
        }
        let last = BASELINE_ID;
        for (const m of migrations) {
          if (!applied.has(m.id)) {
            const t0 = Date.now();
            for (const stmt of splitStatements(m.up)) await conn.query(stmt);
            await conn.query(`INSERT INTO \`${TABLE}\` (id, checksum, duration_ms) VALUES (?,?,?)`, [m.id, m.checksum, Date.now() - t0]);
          }
          last = m.id;
        }
        return { baselineVersion: BASELINE_ID, schemaVersion: last };
      } finally {
        await conn.query("SELECT RELEASE_LOCK('es_provision_schema')").catch(() => undefined);
      }
    } finally {
      await conn.end().catch(() => undefined);
    }
  }
}

export class MysqlTenantSeeder implements TenantSeeder {
  async seedAdmin(dsn: string, input: { email: string; name: string }): Promise<{ created: boolean; inviteToken?: string }> {
    const conn = await mysql.createConnection({ uri: dsn });
    try {
      const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE email = ? LIMIT 1", [input.email]);
      if (rows[0]) return { created: false };
      const inviteToken = crypto.randomBytes(32).toString("hex");
      const openId = `local_${crypto.randomBytes(12).toString("hex")}`;
      await conn.query(
        `INSERT INTO users (openId, name, email, loginMethod, role, isActive, inviteToken, inviteTokenExpiry, inviteAccepted)
         VALUES (?, ?, ?, 'local', 'admin', 1, ?, ?, 0)`,
        [openId, input.name, input.email, inviteToken, new Date(Date.now() + 7 * 86_400_000)],
      );
      // Propietario de la empresa: el administrador del alta. Ajuste sensible (no editable desde el panel).
      await conn.query(
        "INSERT IGNORE INTO system_settings (`key`, value, category, label, is_sensitive, is_public) VALUES ('company_owner_email', ?, 'general', 'Propietario de la empresa', 1, 0)",
        [input.email],
      );
      return { created: true, inviteToken };
    } finally {
      await conn.end().catch(() => undefined);
    }
  }

  /** Siembra una plantilla inicial sin pisar lo que el tenant ya tenga. */
  async seedTemplate(dsn: string, templateId: string): Promise<void> {
    const tpl = getTemplate(templateId);
    if (!tpl) throw new Error(`Plantilla desconocida: ${templateId}`);
    const conn = await mysql.createConnection({ uri: dsn });
    try {
      const [b] = await conn.query<mysql.RowDataPacket[]>("SELECT value FROM system_settings WHERE `key` = 'brand_name' LIMIT 1");
      const brand = String(b[0]?.value ?? "") || "Mi empresa";
      for (const [key, value] of Object.entries(tpl.settings)) {
        await conn.query(
          "INSERT IGNORE INTO system_settings (`key`, value, category, label) VALUES (?, ?, 'theme', ?)",
          [key, value, key],
        );
      }
      for (const p of tpl.pages) {
        await conn.query(
          "INSERT IGNORE INTO static_pages (slug, title, content, metaTitle, metaDescription, isPublished) VALUES (?,?,?,?,?,1)",
          [p.slug, p.title, renderTemplateText(p.content, brand), p.title, p.metaDescription ? renderTemplateText(p.metaDescription, brand) : null],
        );
      }
      const [m] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM menu_items");
      if (Number(m[0].n) === 0) {
        let order = 0;
        for (const it of tpl.menu) {
          await conn.query("INSERT INTO menu_items (label, url, menuZone, sortOrder, isActive) VALUES (?,?,?,?,1)", [it.label, it.url, it.zone, order++]);
        }
      }
    } finally {
      await conn.end().catch(() => undefined);
    }
  }

  async seedBranding(dsn: string, settings: Record<string, string>): Promise<void> {
    const conn = await mysql.createConnection({ uri: dsn });
    try {
      for (const [key, value] of Object.entries(settings)) {
        await conn.query(
          "INSERT INTO system_settings (`key`, value, category, label) VALUES (?, ?, 'brand', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
          [key, value, key],
        );
      }
    } finally {
      await conn.end().catch(() => undefined);
    }
  }
}

export class MysqlProvisioningStore implements ProvisioningStore {
  constructor(private pool: Pick<mysql.Pool, "query">) {}

  async get(tenantId: string): Promise<ProvisioningRecord | null> {
    const [rows] = await this.pool.query<mysql.RowDataPacket[]>(
      "SELECT request, steps, status, attempts, last_error, updated_at FROM tenant_provisioning WHERE tenant_id = ?",
      [tenantId],
    );
    const r = rows[0];
    if (!r) return null;
    const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
    return {
      tenantId,
      request: parse(r.request),
      steps: parse(r.steps),
      status: r.status,
      attempts: Number(r.attempts),
      lastError: r.last_error ?? null,
      updatedAt: new Date(r.updated_at).getTime(),
    };
  }

  async put(rec: ProvisioningRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO tenant_provisioning (tenant_id, request, steps, status, attempts, last_error)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE request = VALUES(request), steps = VALUES(steps), status = VALUES(status),
         attempts = VALUES(attempts), last_error = VALUES(last_error)`,
      [rec.tenantId, JSON.stringify(rec.request), JSON.stringify(rec.steps), rec.status, rec.attempts, rec.lastError],
    );
  }
}
