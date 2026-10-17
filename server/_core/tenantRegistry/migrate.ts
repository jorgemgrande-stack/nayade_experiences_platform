/**
 * Aplicador de migraciones del registro (`db/registry/NNNN_*.sql`).
 *
 *  - Ordenado por número; sin huecos (0000, 0001, …).
 *  - Estado en `registry_meta.schema_version`. El marcador lo gobierna este aplicador: solo avanza a
 *    una versión después de verificar en `information_schema` todos los objetos obligatorios de esa
 *    migración (tablas y triggers, estos con su definición). Si una migración falla o queda
 *    incompleta, el marcador vuelve a la versión anterior verificada.
 *  - Antes de aplicar nada se verifica la integridad de las versiones ya registradas: una migración
 *    que consta como aplicada pero a la que le faltan objetos (p. ej. triggers de auditoría no
 *    creados por falta de privilegios) se detecta y el plan la muestra. Volver a aplicarla (junto con
 *    las posteriores) exige `repair: true` explícito: nunca se reaplica en cascada sin que una persona
 *    haya revisado la causa. Los ficheros son idempotentes y no destruyen datos (`IF NOT EXISTS`;
 *    solo se recrean triggers).
 *  - Los errores de privilegios de MySQL se informan como tales (`privileges`); nunca se activa
 *    `log_bin_trust_function_creators` ni se rebaja ninguna comprobación.
 *  - Por defecto es un plan (no escribe). Si no puede garantizarse la integridad, falla.
 */
import fs from "node:fs";
import path from "node:path";
import type mysql from "mysql2/promise";

export interface RegistryMigrationFile {
  version: string;
  file: string;
}

export interface ExpectedTrigger {
  name: string;
  timing: "BEFORE" | "AFTER";
  event: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  statement: string;
}

export interface ExpectedObjects {
  tables: string[];
  triggers: ExpectedTrigger[];
}

export interface IntegrityIssue {
  version: string;
  kind: "missing_table" | "missing_trigger" | "trigger_mismatch";
  object: string;
}

export interface RegistryMigrationResult {
  current: string | null;
  target: string | null;
  pending: string[];
  applied: string[];
  /** Versiones registradas como aplicadas a las que les faltan objetos (se reaplican). */
  incomplete: string[];
  issues: IntegrityIssue[];
  dryRun: boolean;
}

export class RegistryMigrationError extends Error {
  constructor(
    public readonly code: "gap" | "no_files" | "failed" | "version_mismatch" | "privileges" | "incomplete",
    message: string,
    public readonly issues: IntegrityIssue[] = [],
  ) {
    super(message);
    this.name = "RegistryMigrationError";
  }
}

/** Códigos de MySQL que indican falta de privilegios (no un SQL incorrecto). */
const PRIVILEGE_ERRORS = new Set([
  "ER_BINLOG_CREATE_ROUTINE_NEED_SUPER",
  "ER_SPECIFIC_ACCESS_DENIED_ERROR",
  "ER_TABLEACCESS_DENIED_ERROR",
  "ER_COLUMNACCESS_DENIED_ERROR",
  "ER_DBACCESS_DENIED_ERROR",
  "ER_ACCESS_DENIED_ERROR",
]);

export function listRegistryMigrations(dir: string): RegistryMigrationFile[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/i.test(f))
    .sort()
    .map((f) => ({ version: f.slice(0, 4), file: path.join(dir, f) }));
  if (files.length === 0) throw new RegistryMigrationError("no_files", "No hay migraciones del registro");
  files.forEach((f, i) => {
    if (Number(f.version) !== i) throw new RegistryMigrationError("gap", `Falta la migración ${String(i).padStart(4, "0")}`);
  });
  return files;
}

const stripComments = (sql: string) => sql.replace(/^--.*$/gm, "");
const normalizeStatement = (s: string) => s.replace(/\s+/g, " ").trim().replace(/;+$/, "").trim();

/** Objetos obligatorios que declara una migración (deducidos de su SQL). */
export function expectedObjects(sql: string): ExpectedObjects {
  const text = stripComments(sql);
  const tables = Array.from(text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi), (m) => m[1]);
  const triggers = Array.from(
    text.matchAll(/CREATE\s+TRIGGER\s+`?(\w+)`?\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+ON\s+`?(\w+)`?\s+FOR\s+EACH\s+ROW\s+([^;]+);/gi),
  ).map((m) => ({
    name: m[1],
    timing: m[2].toUpperCase() as ExpectedTrigger["timing"],
    event: m[3].toUpperCase() as ExpectedTrigger["event"],
    table: m[4],
    statement: normalizeStatement(m[5]),
  }));
  const declared = (text.match(/CREATE\s+TRIGGER\b/gi) ?? []).length;
  if (declared !== triggers.length) {
    throw new RegistryMigrationError("failed", "No se pudo interpretar un CREATE TRIGGER: su integridad no sería verificable");
  }
  return { tables, triggers };
}

async function currentVersion(pool: Pick<mysql.Pool, "query">): Promise<string | null> {
  try {
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT v FROM registry_meta WHERE k = 'schema_version'");
    return rows[0]?.v ?? null;
  } catch (e: any) {
    if (e?.code === "ER_NO_SUCH_TABLE") return null;
    throw e;
  }
}

/** Fija el marcador en `version` (o lo elimina si es `null`). Sin `registry_meta` no hay nada que fijar. */
async function setVersion(pool: Pick<mysql.Pool, "query">, version: string | null): Promise<void> {
  try {
    if (version === null) await pool.query("DELETE FROM registry_meta WHERE k = 'schema_version'");
    else
      await pool.query("INSERT INTO registry_meta (k, v) VALUES ('schema_version', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)", [version]);
  } catch (e: any) {
    if (e?.code !== "ER_NO_SUCH_TABLE") throw e;
  }
}

/** Comprueba en `information_schema` los objetos obligatorios de las migraciones indicadas. */
export async function verifyRegistryObjects(
  pool: Pick<mysql.Pool, "query">,
  files: RegistryMigrationFile[],
): Promise<IntegrityIssue[]> {
  if (files.length === 0) return [];
  const [tRows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
  );
  const [gRows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event,
            EVENT_OBJECT_TABLE AS tbl, ACTION_ORIENTATION AS orientation, ACTION_STATEMENT AS stmt
       FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()`,
  );
  const tables = new Set(tRows.map((r) => String(r.name).toLowerCase()));
  const triggers = new Map(gRows.map((r) => [String(r.name).toLowerCase(), r]));
  const issues: IntegrityIssue[] = [];
  for (const f of files) {
    const exp = expectedObjects(fs.readFileSync(f.file, "utf8"));
    for (const t of exp.tables) {
      if (!tables.has(t.toLowerCase())) issues.push({ version: f.version, kind: "missing_table", object: t });
    }
    for (const t of exp.triggers) {
      const got = triggers.get(t.name.toLowerCase());
      if (!got) {
        issues.push({ version: f.version, kind: "missing_trigger", object: t.name });
        continue;
      }
      const same =
        String(got.timing).toUpperCase() === t.timing &&
        String(got.event).toUpperCase() === t.event &&
        String(got.tbl).toLowerCase() === t.table.toLowerCase() &&
        String(got.orientation).toUpperCase() === "ROW" &&
        normalizeStatement(String(got.stmt)) === t.statement;
      if (!same) issues.push({ version: f.version, kind: "trigger_mismatch", object: t.name });
    }
  }
  return issues;
}

function migrationError(version: string, e: any): RegistryMigrationError {
  const code = typeof e?.code === "string" ? e.code : "error";
  if (PRIVILEGE_ERRORS.has(code)) {
    return new RegistryMigrationError(
      "privileges",
      `Migración ${version}: privilegios insuficientes (${code}). El usuario de migración necesita CREATE, ALTER, ` +
        `INDEX, REFERENCES y TRIGGER sobre la BD del registro; con el binlog activo, crear triggers exige además ` +
        `SUPER (o que un administrador active de forma explícita y documentada log_bin_trust_function_creators). ` +
        `La versión ${version} NO se ha registrado como aplicada.`,
    );
  }
  return new RegistryMigrationError("failed", `Migración ${version} fallida: ${code}`);
}

/** `pool` debe permitir `multipleStatements`. */
export async function migrateRegistry(
  pool: Pick<mysql.Pool, "query">,
  dir: string,
  opts: { dryRun?: boolean; repair?: boolean } = {},
): Promise<RegistryMigrationResult> {
  const dryRun = opts.dryRun !== false;
  const files = listRegistryMigrations(dir);
  const current = await currentVersion(pool);

  // Integridad de lo ya registrado: una versión «aplicada» con objetos ausentes se reaplica.
  const recorded = current === null ? [] : files.filter((f) => f.version <= current);
  const issues = await verifyRegistryObjects(pool, recorded);
  const incomplete = Array.from(new Set(issues.map((i) => i.version))).sort();
  const from = incomplete[0] ?? null;
  const pending = files.filter((f) => (from !== null ? f.version >= from : current === null || f.version > current));

  const result: RegistryMigrationResult = {
    current,
    target: files[files.length - 1].version,
    pending: pending.map((f) => f.version),
    applied: [],
    incomplete,
    issues,
    dryRun,
  };
  if (dryRun) return result;
  if (incomplete.length && !opts.repair) {
    throw new RegistryMigrationError(
      "incomplete",
      `Versiones registradas con objetos ausentes o alterados: ${incomplete.join(", ")}. No se reaplican en cascada ` +
        `sin --repair: revisa antes la causa (privilegios, cambios manuales) y repite con --repair.`,
      issues,
    );
  }

  for (const f of pending) {
    const idx = files.indexOf(f);
    const previous = idx > 0 ? files[idx - 1].version : null;
    // El marcador no puede quedar por delante de lo verificado mientras se (re)aplica esta versión.
    if (from !== null && f.version <= (current ?? "")) await setVersion(pool, previous);
    try {
      await pool.query(stripComments(fs.readFileSync(f.file, "utf8")));
    } catch (e: any) {
      await setVersion(pool, previous);
      throw migrationError(f.version, e);
    }
    const missing = await verifyRegistryObjects(pool, [f]);
    if (missing.length) {
      await setVersion(pool, previous);
      throw new RegistryMigrationError(
        "incomplete",
        `Migración ${f.version} incompleta: ${missing.map((m) => `${m.kind}:${m.object}`).join(", ")}`,
        missing,
      );
    }
    await setVersion(pool, f.version);
    const now = await currentVersion(pool);
    if (now !== f.version) {
      throw new RegistryMigrationError("version_mismatch", `Tras ${f.version} la versión es ${now ?? "ninguna"}`);
    }
    result.applied.push(f.version);
  }

  // Garantía final: todas las versiones hasta la registrada tienen sus objetos.
  const finalVersion = await currentVersion(pool);
  const finalIssues = await verifyRegistryObjects(pool, files.filter((f) => finalVersion !== null && f.version <= finalVersion));
  if (finalIssues.length) {
    throw new RegistryMigrationError("incomplete", "El registro no supera la verificación de integridad", finalIssues);
  }
  return result;
}
