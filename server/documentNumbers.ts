/**
 * Sistema de numeración correlativa centralizado
 *
 * Genera números únicos, auditables y correlativos para todos los tipos
 * de documento del sistema: presupuestos, facturas, reservas, TPV, cupones,
 * liquidaciones y anulaciones.
 *
 * Reglas:
 * - Nunca reutiliza números
 * - Nunca modifica números ya emitidos
 * - Reinicio anual automático
 * - Registro de auditoría en document_number_logs
 * - Incremento atómico: `UPDATE … SET current_number = LAST_INSERT_ID(current_number + 1)` y lectura
 *   de `LAST_INSERT_ID()` en la misma conexión, de modo que dos altas simultáneas nunca leen el mismo
 *   valor (antes se hacían UPDATE y SELECT por separado, en conexiones del pool que podían ser distintas).
 */

import type mysql from "mysql2/promise";
import { legacyDb, legacyPool } from "./_core/legacyDb";
import { eq, and, sql } from "drizzle-orm";
import { documentCounters, documentNumberLogs, invoices } from "../drizzle/schema";
import { madridYear } from "./utils/timezone";

// Base de datos del registro (pool compartido, resolución perezosa).
let _tablesReady = false;

function getDb() {
  return legacyDb();
}

// Crea las tablas si no existen — idempotente. Ya NO se ejecuta al generar números: solo desde el
// mantenimiento explícito (ensureDocumentNumberTables en --schema-maintenance).
async function ensureTables(db: ReturnType<typeof getDb>): Promise<void> {
  if (_tablesReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS \`document_counters\` (
      \`id\`             int         AUTO_INCREMENT NOT NULL,
      \`document_type\`  varchar(32) NOT NULL,
      \`year\`           int         NOT NULL,
      \`current_number\` int         NOT NULL DEFAULT 0,
      \`prefix\`         varchar(16) NOT NULL,
      \`updated_at\`     timestamp   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT \`document_counters_id\` PRIMARY KEY(\`id\`)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS \`document_number_logs\` (
      \`id\`              int         AUTO_INCREMENT NOT NULL,
      \`document_type\`   varchar(32) NOT NULL,
      \`document_number\` varchar(64) NOT NULL,
      \`year\`            int         NOT NULL,
      \`sequence\`        int         NOT NULL,
      \`generated_at\`    timestamp   NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`generated_by\`    varchar(64),
      \`context\`         varchar(128),
      CONSTRAINT \`document_number_logs_id\` PRIMARY KEY(\`id\`)
    )
  `);
  _tablesReady = true;
}

/** Paso del mantenimiento explícito de esquema (no se llama en tiempo de ejecución). */
export async function ensureDocumentNumberTables(): Promise<void> {
  await ensureTables(getDb()!);
}

// --- Tipos --------------------------------------------------------------------

export type DocumentType =
  | "presupuesto"
  | "factura"
  | "reserva"
  | "tpv"
  | "cupon"
  | "liquidacion"
  | "anulacion"
  | "abono"
  | "propuesta";

const DEFAULT_PREFIXES: Record<DocumentType, string> = {
  presupuesto: "PRES",
  factura: "FAC",
  reserva: "RES",
  tpv: "TPV",
  cupon: "CUP",
  liquidacion: "LIQ",
  anulacion: "ANU",
  abono: "ABN",
  propuesta: "PROP",
};

// Padding de 4 dígitos para mantener compatibilidad con el formato actual
const SEQUENCE_PADDING = 4;

// --- Secuencia atómica --------------------------------------------------------

// Segundos de espera máxima del bloqueo que serializa la creación de la serie de un año.
const CREATE_LOCK_TIMEOUT_S = 10;

/**
 * Siguiente valor de la serie `documentType`/`year`, atómico frente a altas simultáneas (también entre
 * varias instancias del servidor): el incremento y la lectura ocurren en la misma conexión mediante
 * `LAST_INSERT_ID(expr)`, que es local a cada conexión.
 *
 * Si la serie del año no existe se crea a 0 bajo un bloqueo con nombre (GET_LOCK) por base de datos, tipo
 * y año, para que dos altas a la vez no creen dos filas; después se incrementa como cualquier otra, así que
 * el primer número del año sigue siendo el 1. Si ya hubiera filas duplicadas (bases anteriores al índice
 * único de la migración 0005) se usa siempre la de menor id, la misma que leía la versión anterior.
 */
async function nextSequence(
  documentType: DocumentType,
  year: number
): Promise<{ sequence: number; prefix: string }> {
  const conn = await legacyPool().getConnection();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const [found] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT id FROM document_counters WHERE document_type = ? AND `year` = ? ORDER BY id LIMIT 1",
        [documentType, year]
      );
      const counterId = found[0]?.id as number | undefined;
      if (counterId === undefined) {
        await createCounterIfMissing(conn, documentType, year);
        continue;
      }
      const [upd] = await conn.query<mysql.ResultSetHeader>(
        "UPDATE document_counters SET current_number = LAST_INSERT_ID(current_number + 1) WHERE id = ?",
        [counterId]
      );
      if (upd.affectedRows !== 1) continue; // la fila desapareció entre lectura y escritura: reintentar
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        "SELECT LAST_INSERT_ID() AS seq, prefix FROM document_counters WHERE id = ?",
        [counterId]
      );
      if (rows[0]) return { sequence: Number(rows[0].seq), prefix: String(rows[0].prefix) };
    }
    throw new Error(`[documentNumbers] No se pudo obtener el contador para ${documentType}/${year}`);
  } finally {
    conn.release();
  }
}

/** Crea la serie del año (a 0) si no existe, serializando la creación con un bloqueo con nombre. */
async function createCounterIfMissing(
  conn: mysql.PoolConnection,
  documentType: DocumentType,
  year: number
): Promise<void> {
  // El nombre del bloqueo es global al servidor MySQL: incluye la base de datos (cada empresa tiene la
  // suya) y se resume con MD5 para no superar los 64 caracteres permitidos.
  const lockName = "MD5(CONCAT('es_docnum:', DATABASE(), ':', ?, ':', ?))";
  const [lock] = await conn.query<mysql.RowDataPacket[]>(`SELECT GET_LOCK(${lockName}, ?) AS got`, [
    documentType,
    year,
    CREATE_LOCK_TIMEOUT_S,
  ]);
  if (Number(lock[0]?.got) !== 1) {
    throw new Error(`[documentNumbers] No se pudo bloquear la creación del contador ${documentType}/${year}`);
  }
  try {
    const [exists] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT id FROM document_counters WHERE document_type = ? AND `year` = ? LIMIT 1",
      [documentType, year]
    );
    if (exists.length) return;
    try {
      await conn.query(
        "INSERT INTO document_counters (document_type, `year`, current_number, prefix) VALUES (?, ?, 0, ?)",
        [documentType, year, DEFAULT_PREFIXES[documentType]]
      );
    } catch (insertErr: unknown) {
      // Con el índice único (migración 0005) otra instancia pudo crearla antes: no es un error.
      if ((insertErr as { code?: string })?.code !== "ER_DUP_ENTRY") throw insertErr;
    }
  } finally {
    await conn.query(`SELECT RELEASE_LOCK(${lockName})`, [documentType, year]).catch(() => undefined);
  }
}

// --- Función principal --------------------------------------------------------

/**
 * Genera el siguiente número correlativo para el tipo de documento indicado.
 *
 * @param documentType - Tipo de documento (presupuesto, factura, etc.)
 * @param context - Contexto de generación para auditoría (ej: 'crm:confirmPayment')
 * @param generatedBy - ID de usuario o 'system'
 * @param existsCheck - Opcional: indica si un número ya está ocupado por un documento guardado (p. ej.
 *   documentos importados o creados sin pasar por el contador). Si lo está, el contador avanza hasta el
 *   primer número libre en vez de devolver uno que haría fallar el alta por duplicado. Adaptado de
 *   Skicenter (`server/documentNumbers.ts`, existsCheck).
 * @returns Número formateado, ej: "FAC-2026-0005"
 */
export async function generateDocumentNumber(
  documentType: DocumentType,
  context?: string,
  generatedBy?: string,
  existsCheck?: (candidateNumber: string) => Promise<boolean>
): Promise<string> {
  const db = getDb();
  // El año de la serie es el de Madrid: con `getFullYear()` (zona del servidor, UTC) un documento emitido
  // el 1 de enero entre las 00:00 y la 01:00 de Madrid salía con el año anterior.
  const year = madridYear();

  // Sin DDL aquí: las tablas las garantiza el mantenimiento explícito y las vigila el arranque.

  // Pasos 1 y 2: incremento atómico y lectura del valor en la MISMA conexión (ver nextSequence).
  let { sequence, prefix } = await nextSequence(documentType, year);
  let documentNumber = `${prefix}-${year}-${String(sequence).padStart(SEQUENCE_PADDING, "0")}`;
  if (existsCheck) {
    for (let guard = 0; await existsCheck(documentNumber); guard++) {
      if (guard >= 50) {
        throw new Error(`[documentNumbers] No se encontró un número libre para ${documentType}/${year} tras 50 intentos`);
      }
      ({ sequence, prefix } = await nextSequence(documentType, year));
      documentNumber = `${prefix}-${year}-${String(sequence).padStart(SEQUENCE_PADDING, "0")}`;
    }
  }

  // Paso 3: Registrar en el log de auditoría (no bloquea si falla)
  try {
    await db.insert(documentNumberLogs).values({
      documentType,
      documentNumber,
      year,
      sequence,
      generatedBy: generatedBy ?? "system",
      context: context ?? null,
    });
  } catch (logErr) {
    console.error("[documentNumbers] Error al registrar en log de auditoría:", logErr);
    // No lanzar error — el número ya fue generado correctamente
  }

  return documentNumber;
}

// --- Función de consulta (sin efecto secundario) ------------------------------

/**
 * Devuelve el estado actual de todos los contadores.
 * Solo lectura, no genera números.
 */
export async function getAllCounters() {
  return getDb().select().from(documentCounters).orderBy(documentCounters.documentType);
}

/**
 * Actualiza el prefijo de una serie (solo admin).
 * No afecta a documentos ya emitidos.
 */
export async function updateCounterPrefix(
  documentType: DocumentType,
  year: number,
  newPrefix: string
): Promise<void> {
  const db = getDb();
  const where = and(eq(documentCounters.documentType, documentType), eq(documentCounters.year, year));
  const [existing] = await db.select({ id: documentCounters.id }).from(documentCounters).where(where).limit(1);
  // Serie aún sin usar (empresa nueva o año nuevo): se crea vacía con el prefijo elegido; antes el
  // cambio se perdía y el primer documento salía con el prefijo por defecto.
  if (!existing) {
    await db.insert(documentCounters).values({ documentType, year, currentNumber: 0, prefix: newPrefix });
    return;
  }
  await db.update(documentCounters).set({ prefix: newPrefix }).where(where);
}

/** Series fiscales: su contador nunca puede retroceder por debajo de lo ya emitido. */
export const FISCAL_DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>(["factura", "abono"]);

/** Rechazo de un ajuste de contador que reutilizaría números ya emitidos. */
export class CounterResetError extends Error {}

/**
 * Comprueba el nuevo valor de una serie fiscal: el contador guarda el ÚLTIMO número emitido, así que no
 * puede quedar por debajo de él (el siguiente documento repetiría un número). Las series no fiscales no
 * se comprueban.
 */
export function assertCounterValueAllowed(documentType: DocumentType, newValue: number, lastIssued: number): void {
  if (!FISCAL_DOCUMENT_TYPES.has(documentType)) return;
  if (newValue < lastIssued) {
    throw new CounterResetError(
      `No se puede bajar el contador por debajo del último número emitido (${lastIssued}): se repetirían números de documentos ya emitidos. Elige ${lastIssued} o un valor mayor.`
    );
  }
}

/** Último número emitido de una serie: el mayor entre el registro de numeración y los documentos guardados con su prefijo actual. */
async function lastIssuedSequence(db: ReturnType<typeof getDb>, documentType: DocumentType, year: number, prefix: string): Promise<number> {
  const [logged] = await db
    .select({ last: sql<number | null>`MAX(${documentNumberLogs.sequence})` })
    .from(documentNumberLogs)
    .where(and(
      eq(documentNumberLogs.documentType, documentType),
      eq(documentNumberLogs.year, year),
      sql`(${documentNumberLogs.context} IS NULL OR ${documentNumberLogs.context} <> 'admin:resetCounter')`
    ));
  const head = `${prefix}-${year}-`;
  const like = head.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";
  const [stored] = await db
    .select({ last: sql<number | null>`MAX(CAST(SUBSTRING(${invoices.invoiceNumber}, ${head.length + 1}) AS UNSIGNED))` })
    .from(invoices)
    .where(sql`${invoices.invoiceNumber} LIKE ${like}`);
  return Math.max(Number(logged?.last ?? 0), Number(stored?.last ?? 0));
}

/**
 * Ajusta manualmente el contador a un valor específico (solo admin, con auditoría).
 * USAR CON EXTREMA PRECAUCIÓN — solo para correcciones de inicio de año. En las series fiscales
 * (facturas y abonos) nunca por debajo del último número emitido (`CounterResetError`).
 */
export async function resetCounter(
  documentType: DocumentType,
  year: number,
  newValue: number,
  resetBy: string
): Promise<void> {
  const db = getDb();
  const where = and(eq(documentCounters.documentType, documentType), eq(documentCounters.year, year));
  await db.transaction(async (tx) => {
    // El bloqueo de la fila espera a cualquier alta en curso de la serie antes de comprobar
    const [counter] = await tx.select({ prefix: documentCounters.prefix }).from(documentCounters).where(where).for("update");
    if (FISCAL_DOCUMENT_TYPES.has(documentType)) {
      const last = await lastIssuedSequence(tx as unknown as ReturnType<typeof getDb>, documentType, year, counter?.prefix ?? DEFAULT_PREFIXES[documentType]);
      assertCounterValueAllowed(documentType, newValue, last);
    }
    await tx.update(documentCounters).set({ currentNumber: newValue }).where(where);
  });

  // Log del reset
  await db.insert(documentNumberLogs).values({
    documentType,
    documentNumber: `RESET-${documentType}-${year}-to-${newValue}`,
    year,
    sequence: newValue,
    generatedBy: resetBy,
    context: "admin:resetCounter",
  });
}

/**
 * Devuelve el historial de generación de números para un tipo de documento.
 */
export async function getDocumentNumberLogs(documentType?: DocumentType, limit = 100) {
  const db = getDb();
  const query = db
    .select()
    .from(documentNumberLogs)
    .orderBy(sql`${documentNumberLogs.generatedAt} DESC`)
    .limit(limit);

  if (documentType) {
    return db
      .select()
      .from(documentNumberLogs)
      .where(eq(documentNumberLogs.documentType, documentType))
      .orderBy(sql`${documentNumberLogs.generatedAt} DESC`)
      .limit(limit);
  }

  return query;
}

