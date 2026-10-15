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

// ── Carriles y comprobaciones de seguridad del ejecutor (sin base de datos) ─────────────────

/**
 * Un carril es un directorio de migraciones ligado a UN tipo de base de datos. `requires` son
 * tablas base que deben existir en el destino: si faltan, la BD no es de ese carril (p. ej. aplicar
 * las migraciones de la app sobre la BD del CRM) y no se toca.
 */
export type Lane = { name: string; dir: string; requires: string[] };

export const KNOWN_LANES: Record<string, { name: string; requires: string[] }> = {
  "db/migrations": { name: "app", requires: ["users"] },
  "db/crm/migrations": { name: "crm", requires: ["crm_companies"] },
};

/** Carril de `dirArg` (relativo a `root`): conocido o declarado en `<dir>/lane.json`. */
export function resolveLane(dirArg: string | undefined, root: string): { lane?: Lane; error?: string } {
  if (!dirArg) {
    return { error: `Indica el carril con --dir (${Object.keys(KNOWN_LANES).join(" o ")}): no hay carril por defecto.` };
  }
  const abs = path.resolve(root, dirArg);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  const known = KNOWN_LANES[rel];
  if (known) return { lane: { ...known, dir: abs } };
  const manifest = path.join(abs, "lane.json");
  if (fs.existsSync(manifest)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifest, "utf8")) as { name?: unknown; requires?: unknown };
      if (typeof m.name === "string" && /^[a-z0-9_-]{1,40}$/.test(m.name) && Array.isArray(m.requires) && m.requires.every((t) => typeof t === "string")) {
        return { lane: { name: m.name, dir: abs, requires: m.requires as string[] } };
      }
    } catch {
      // cae al error de abajo
    }
    return { error: `${rel}/lane.json no es válido: se espera {"name": "...", "requires": ["tabla", ...]}` };
  }
  return { error: `Carril desconocido: ${rel}. Usa uno conocido (${Object.keys(KNOWN_LANES).join(", ")}) o declara ${rel}/lane.json.` };
}

/** Estado leído de la BD de destino (solo lectura). */
export type LedgerState = {
  /** id → checksum de las migraciones registradas como aplicadas. */
  applied: Map<string, string>;
  /** Carril al que quedó ligada la BD (null en registros anteriores a esta versión del ejecutor). */
  lane: string | null;
  /** Migración que empezó y no terminó (`up:<id>` o `down:<id>`). */
  inProgress: string | null;
  /** Tablas existentes en la BD. */
  tables: Set<string>;
};

/**
 * Problemas que impiden continuar: carril equivocado, migración a medias, registros que no son de
 * este directorio, contenidos cambiados o huecos. Vacío = se puede operar.
 */
export function ledgerProblems(migrations: Migration[], s: LedgerState, lane: Lane): string[] {
  const out: string[] = [];
  if (s.lane && s.lane !== lane.name) out.push(`La BD está ligada al carril «${s.lane}», no a «${lane.name}»: --dir equivocado.`);
  const missing = lane.requires.filter((t) => !s.tables.has(t.toLowerCase()));
  if (missing.length) out.push(`Faltan las tablas base del carril «${lane.name}» (${missing.join(", ")}): esta BD no es de este carril o no tiene su esquema base.`);
  if (s.inProgress) {
    out.push(
      `La migración ${s.inProgress} empezó y no terminó: el esquema puede estar a medias. Revísalo a mano y ` +
        `regístralo con «resolve --id <id> --as applied|not-applied» antes de continuar.`,
    );
  }
  const byId = new Map(migrations.map((m) => [m.id, m]));
  for (const [id, sum] of Array.from(s.applied.entries())) {
    const m = byId.get(id);
    if (!m) out.push(`${id} figura como aplicada pero no existe en este carril: --dir equivocado o fichero borrado.`);
    else if (m.checksum !== sum) out.push(`${id} ya estaba aplicada y su contenido cambió (checksum distinto): crea una migración nueva.`);
  }
  const firstPending = migrations.findIndex((m) => !s.applied.has(m.id));
  if (firstPending >= 0) {
    const later = migrations.slice(firstPending + 1).filter((m) => s.applied.has(m.id));
    if (later.length) out.push(`Hueco: ${migrations[firstPending].id} no está aplicada pero sí ${later.map((m) => m.id).join(", ")}.`);
  }
  return out;
}

/** Identificación explícita del destino antes de escribir. `null` = permitido. */
export function targetProblem(o: { apply: boolean; confirm: string | undefined; actualDb: string | null; urlHost: string; allowRemote: boolean }): string | null {
  if (!o.apply) return null;
  if (!o.actualDb) return "La URL no selecciona ninguna base de datos.";
  if (o.confirm !== o.actualDb) {
    return `Para escribir hay que identificar el destino: añade --confirm-database ${o.actualDb} (nombre real devuelto por el servidor).`;
  }
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(o.urlHost);
  if (!loopback && !o.allowRemote) {
    return `Destino remoto (${o.urlHost}): exige además --allow-remote, backup verificado y la autorización correspondiente.`;
  }
  return null;
}
