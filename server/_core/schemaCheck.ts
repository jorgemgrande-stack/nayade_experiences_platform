/**
 * Comprobación del esquema de la app (modo single) — SOLO LECTURA.
 *
 * El arranque ya no aplica migraciones ni DDL: comprueba y avisa. Los cambios de esquema se aplican
 * de forma explícita con `--schema-maintenance` (ver `schemaMaintenance.ts`).
 *
 *  - Migraciones de drizzle pendientes: mismo criterio que `drizzle-orm/mysql2/migrator` (una
 *    migración del journal está pendiente si su `folderMillis` es posterior al `created_at` más
 *    reciente de `__drizzle_migrations`). Así se informa de exactamente lo que antes se aplicaba
 *    en silencio al arrancar.
 *  - Tablas y columnas de `drizzle/schema.ts` que no existen en la BD.
 *  - Deriva conocida y documentada (`KNOWN_ABSENT_TABLES`): se informa, no cuenta como fallo.
 *
 * Solo ejecuta SELECT. Nunca imprime la cadena de conexión.
 */
import fs from "node:fs";
import path from "node:path";
import type mysql from "mysql2/promise";
import { is } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import * as schema from "../../drizzle/schema";

/**
 * Tablas declaradas en `schema.ts` que producción no tiene A PROPÓSITO
 * (docs/db/RECONCILIACION_ESQUEMA_2026-10-13.md §1): crear las tablas RBAC sin sembrar antes los
 * permisos denegaría el acceso a usuarios legítimos. Su ausencia no es un fallo de arranque.
 */
export const KNOWN_ABSENT_TABLES: ReadonlySet<string> = new Set(["rbac_roles", "rbac_permissions", "rbac_role_permissions", "rbac_user_roles"]);

type Queryable = Pick<mysql.Connection, "query">;

export interface DrizzleMigration {
  tag: string;
  folderMillis: number;
  hash: string;
}

export interface SchemaReport {
  database: string | null;
  /** Migraciones del journal que `migrate()` aplicaría (en orden). */
  pendingMigrations: string[];
  /** `__drizzle_migrations` no existe: la BD nunca se migró con drizzle. */
  ledgerMissing: boolean;
  /** Migraciones del journal ya cubiertas cuyo hash no figura en la BD (histórico; solo informativo). */
  unmatchedHashes: number;
  missingTables: string[];
  missingColumns: string[];
  /** Ausencias conocidas y documentadas (no cuentan como fallo). */
  knownAbsentTables: string[];
  tablesChecked: number;
  ok: boolean;
}

/** Migraciones de drizzle del repositorio, con su etiqueta del journal. */
export function readDrizzleMigrations(folder: string): DrizzleMigration[] {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
  const metas = readMigrationFiles({ migrationsFolder: folder });
  return metas.map((m, i) => ({ tag: journal.entries[i]?.tag ?? `#${i}`, folderMillis: m.folderMillis, hash: m.hash }));
}

/** Tablas y columnas que declara `drizzle/schema.ts`. */
export function expectedSchema(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const v of Object.values(schema)) {
    if (!is(v, MySqlTable)) continue;
    const cfg = getTableConfig(v);
    out.set(cfg.name, cfg.columns.map((c) => c.name));
  }
  return out;
}

/** Lo que `migrate()` aplicaría: mismo criterio que drizzle-orm/mysql2/migrator. */
export function pendingDrizzle(files: DrizzleMigration[], lastCreatedAt: number | null): DrizzleMigration[] {
  return files.filter((m) => lastCreatedAt === null || lastCreatedAt < m.folderMillis);
}

export function compareSchema(expected: Map<string, string[]>, actual: Map<string, Set<string>>) {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  const knownAbsentTables: string[] = [];
  for (const [t, cols] of Array.from(expected.entries())) {
    const got = actual.get(t.toLowerCase());
    if (!got) {
      (KNOWN_ABSENT_TABLES.has(t) ? knownAbsentTables : missingTables).push(t);
      continue;
    }
    for (const c of cols) if (!got.has(c.toLowerCase())) missingColumns.push(`${t}.${c}`);
  }
  return { missingTables: missingTables.sort(), missingColumns: missingColumns.sort(), knownAbsentTables: knownAbsentTables.sort() };
}

export async function checkAppSchema(conn: Queryable, opts: { migrationsFolder?: string } = {}): Promise<SchemaReport> {
  const folder = opts.migrationsFolder ?? path.resolve(process.cwd(), "drizzle");
  const [[who]] = (await conn.query("SELECT DATABASE() AS db")) as [mysql.RowDataPacket[], unknown];
  const [colRows] = (await conn.query(
    "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()",
  )) as [mysql.RowDataPacket[], unknown];
  const actual = new Map<string, Set<string>>();
  for (const r of colRows) {
    const t = String(r.t).toLowerCase();
    if (!actual.has(t)) actual.set(t, new Set());
    actual.get(t)!.add(String(r.c).toLowerCase());
  }

  const files = readDrizzleMigrations(folder);
  const ledgerMissing = !actual.has("__drizzle_migrations");
  let lastCreatedAt: number | null = null;
  let unmatchedHashes = 0;
  if (!ledgerMissing) {
    const [last] = (await conn.query("SELECT created_at FROM `__drizzle_migrations` ORDER BY created_at DESC LIMIT 1")) as [mysql.RowDataPacket[], unknown];
    lastCreatedAt = last[0] ? Number(last[0].created_at) : null;
    const [hashes] = (await conn.query("SELECT hash FROM `__drizzle_migrations`")) as [mysql.RowDataPacket[], unknown];
    const known = new Set(hashes.map((h) => String(h.hash)));
    unmatchedHashes = files.filter((m) => lastCreatedAt !== null && m.folderMillis <= lastCreatedAt && !known.has(m.hash)).length;
  }
  const pending = pendingDrizzle(files, lastCreatedAt);
  const expected = expectedSchema();
  const cmp = compareSchema(expected, actual);
  return {
    database: (who?.db as string) ?? null,
    pendingMigrations: pending.map((m) => m.tag),
    ledgerMissing,
    unmatchedHashes,
    ...cmp,
    tablesChecked: expected.size,
    ok: pending.length === 0 && cmp.missingTables.length === 0 && cmp.missingColumns.length === 0,
  };
}

/** Abre una conexión propia, comprueba y la cierra siempre (también si falla). */
export async function checkAppSchemaAt(url: string, opts: { migrationsFolder?: string } = {}): Promise<SchemaReport> {
  const mysql = await import("mysql2/promise");
  const conn = await mysql.default.createConnection(url);
  try {
    return await checkAppSchema(conn, opts);
  } finally {
    await conn.end().catch(() => undefined);
  }
}

const list = (xs: string[], n = 8) => (xs.length > n ? `${xs.slice(0, n).join(", ")} … (+${xs.length - n})` : xs.join(", "));

/** Líneas de log legibles (sin datos sensibles). */
export function describeSchemaReport(r: SchemaReport): string[] {
  const out: string[] = [];
  if (r.ok) {
    out.push(`[Schema] ✓ Esquema al día en «${r.database}»: sin migraciones pendientes; ${r.tablesChecked} tablas de schema.ts comprobadas.`);
  } else {
    out.push(`[Schema] ✗ Esquema NO al día en «${r.database}». El arranque ya NO modifica el esquema: aplica el mantenimiento explícito (ver docs/runbooks/MANTENIMIENTO_ESQUEMA.md).`);
    if (r.pendingMigrations.length) out.push(`[Schema]   · ${r.pendingMigrations.length} migración(es) de drizzle pendiente(s): ${list(r.pendingMigrations)}`);
    if (r.missingTables.length) out.push(`[Schema]   · Faltan ${r.missingTables.length} tabla(s): ${list(r.missingTables)}`);
    if (r.missingColumns.length) out.push(`[Schema]   · Faltan ${r.missingColumns.length} columna(s): ${list(r.missingColumns)}`);
  }
  if (r.ledgerMissing) out.push("[Schema]   · No existe __drizzle_migrations: esta BD nunca se migró con drizzle.");
  if (r.knownAbsentTables.length) out.push(`[Schema]   · Ausencias conocidas y documentadas (no son fallo): ${list(r.knownAbsentTables)}`);
  if (r.unmatchedHashes) out.push(`[Schema]   · ${r.unmatchedHashes} migración(es) antiguas del journal sin hash coincidente en __drizzle_migrations (histórico conocido; informativo).`);
  return out;
}
