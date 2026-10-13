/**
 * Lógica pura (sin base de datos) del ejecutor de migraciones: lectura, validación y
 * división de sentencias. Se prueba de forma unitaria; el CLI está en migrate.ts.
 *
 * Convención de ficheros en db/migrations/:
 *   NNNN_nombre.sql        migración «hacia delante» (obligatoria)
 *   NNNN_nombre.down.sql   reversión (obligatoria salvo marca `-- irreversible: motivo`)
 *
 * Separador de sentencias: `--> statement-breakpoint` o `;` al final de línea.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type Migration = {
  id: string; // "0007_anadir_columna"
  number: number;
  name: string;
  up: string;
  down: string | null;
  irreversible: boolean;
  allowDestructive: boolean;
  checksum: string;
};

const FILE_RE = /^(\d{4})_([a-z0-9_]+?)(\.down)?\.sql$/;

export function checksum(sql: string): string {
  return crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n").trim()).digest("hex");
}

/** Divide un fichero SQL en sentencias ejecutables, sin comentarios. */
export function splitStatements(sql: string): string[] {
  return sql
    .replace(/\r\n/g, "\n")
    .split(/-->\s*statement-breakpoint/g)
    .flatMap((chunk) => chunk.split(/;[ \t]*(?:\n|$)/g))
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

export function loadMigrations(dir: string): { migrations: Migration[]; errors: string[] } {
  const errors: string[] = [];
  if (!fs.existsSync(dir)) return { migrations: [], errors: [`No existe el directorio ${dir}`] };

  const ups = new Map<string, { number: number; name: string; up: string }>();
  const downs = new Map<string, string>();

  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".sql")) continue;
    const m = FILE_RE.exec(file);
    if (!m) {
      errors.push(`${file}: nombre no válido (esperado NNNN_nombre.sql o NNNN_nombre.down.sql)`);
      continue;
    }
    const id = `${m[1]}_${m[2]}`;
    const body = fs.readFileSync(path.join(dir, file), "utf8");
    if (m[3]) downs.set(id, body);
    else ups.set(id, { number: Number(m[1]), name: m[2], up: body });
  }

  for (const id of downs.keys()) {
    if (!ups.has(id)) errors.push(`${id}.down.sql: no existe la migración ${id}.sql`);
  }

  const migrations: Migration[] = [...ups.entries()]
    .map(([id, u]) => {
      const down = downs.get(id) ?? null;
      return {
        id,
        number: u.number,
        name: u.name,
        up: u.up,
        down,
        irreversible: /^\s*--\s*irreversible\s*:/im.test(u.up),
        allowDestructive: /^\s*--\s*allow-destructive\b/im.test(u.up),
        checksum: checksum(u.up),
      };
    })
    .sort((a, b) => a.number - b.number);

  return { migrations, errors };
}

/** Patrones que no deben aparecer en migraciones (sintaxis no válida en MySQL o peligrosa). */
const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i, why: "ADD COLUMN IF NOT EXISTS es sintaxis de MariaDB: MySQL no la admite" },
  { re: /\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/i, why: "CREATE INDEX IF NOT EXISTS no existe en MySQL" },
  { re: /\bDROP\s+COLUMN\s+IF\s+EXISTS\b/i, why: "DROP COLUMN IF EXISTS es sintaxis de MariaDB" },
];

const DESTRUCTIVE = /\b(DROP\s+TABLE|DROP\s+COLUMN|DROP\s+DATABASE|TRUNCATE\b)|\bDELETE\s+FROM\b(?![^;]*\bWHERE\b)/i;

export function validateMigrations(list: Migration[]): string[] {
  const errors: string[] = [];
  const seen = new Set<number>();

  list.forEach((m, i) => {
    if (seen.has(m.number)) errors.push(`${m.id}: número ${String(m.number).padStart(4, "0")} duplicado`);
    seen.add(m.number);
    if (i > 0 && m.number !== list[i - 1].number + 1 && m.number !== list[i - 1].number) {
      errors.push(`${m.id}: hueco de numeración (anterior ${String(list[i - 1].number).padStart(4, "0")})`);
    }
    if (splitStatements(m.up).length === 0) errors.push(`${m.id}: no contiene sentencias`);
    if (!m.down && !m.irreversible) {
      errors.push(`${m.id}: falta ${m.id}.down.sql o la marca «-- irreversible: motivo» en la migración`);
    }
    if (m.down && splitStatements(m.down).length === 0) errors.push(`${m.id}.down.sql: no contiene sentencias`);
    for (const f of FORBIDDEN) {
      if (f.re.test(m.up) || (m.down && f.re.test(m.down))) errors.push(`${m.id}: ${f.why}`);
    }
    if (DESTRUCTIVE.test(m.up) && !m.allowDestructive) {
      errors.push(`${m.id}: contiene una operación destructiva; exige la marca «-- allow-destructive» y backup verificado`);
    }
  });
  return errors;
}
