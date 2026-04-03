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
 * - Usa UPDATE atómico con SELECT para evitar race conditions
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and, sql } from "drizzle-orm";
import { documentCounters, documentNumberLogs } from "../drizzle/schema";

// Pool lazy: se crea la primera vez que se necesita, no al importar el módulo.
// Esto evita crash en arranque si DATABASE_URL aún no está disponible.
let _pool: ReturnType<typeof mysql.createPool> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error("[documentNumbers] DATABASE_URL is not defined");
    }
    _pool = mysql.createPool(process.env.DATABASE_URL);
    _db = drizzle(_pool);
  }
  return _db;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type DocumentType =
  | "presupuesto"
  | "factura"
  | "reserva"
  | "tpv"
  | "cupon"
  | "liquidacion"
  | "anulacion";

const DEFAULT_PREFIXES: Record<DocumentType, string> = {
  presupuesto: "PRES",
  factura: "FAC",
  reserva: "RES",
  tpv: "TPV",
  cupon: "CUP",
  liquidacion: "LIQ",
  anulacion: "ANU",
};

// Padding de 4 dígitos para mantener compatibilidad con el formato actual
const SEQUENCE_PADDING = 4;

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * Genera el siguiente número correlativo para el tipo de documento indicado.
 *
 * @param documentType - Tipo de documento (presupuesto, factura, etc.)
 * @param context - Contexto de generación para auditoría (ej: 'crm:confirmPayment')
 * @param generatedBy - ID de usuario o 'system'
 * @returns Número formateado, ej: "FAC-2026-0005"
 */
export async function generateDocumentNumber(
  documentType: DocumentType,
  context?: string,
  generatedBy?: string
): Promise<string> {
  const db = getDb();
  const year = new Date().getFullYear();

  // Paso 1: Incrementar el contador de forma atómica usando UPDATE + SELECT
  // Primero intentamos incrementar el registro existente
  const updateResult = await db
    .update(documentCounters)
    .set({ currentNumber: sql`current_number + 1` })
    .where(
      and(
        eq(documentCounters.documentType, documentType),
        eq(documentCounters.year, year)
      )
    );

  const affected = (updateResult as unknown as { affectedRows: number }[])?.[0]?.affectedRows ?? 0;

  if (affected === 0) {
    // No existe el contador para este año → crear con valor 1.
    // En caso de inserción concurrente (dos peticiones simultáneas al inicio de año),
    // el segundo INSERT fallará con ER_DUP_ENTRY — en ese caso reintentamos el UPDATE.
    const prefix = DEFAULT_PREFIXES[documentType];
    try {
      await db.insert(documentCounters).values({
        documentType,
        year,
        currentNumber: 1,
        prefix,
      });
    } catch (insertErr: unknown) {
      const mysqlErr = insertErr as { code?: string };
      if (mysqlErr?.code === "ER_DUP_ENTRY") {
        // Otra petición concurrente ya creó el contador — reintentar el incremento
        await db
          .update(documentCounters)
          .set({ currentNumber: sql`current_number + 1` })
          .where(
            and(
              eq(documentCounters.documentType, documentType),
              eq(documentCounters.year, year)
            )
          );
      } else {
        throw insertErr;
      }
    }
  }

  // Paso 2: Leer el valor actual tras el incremento
  const [counter] = await db
    .select()
    .from(documentCounters)
    .where(
      and(
        eq(documentCounters.documentType, documentType),
        eq(documentCounters.year, year)
      )
    )
    .limit(1);

  if (!counter) {
    throw new Error(`[documentNumbers] No se pudo obtener el contador para ${documentType}/${year}`);
  }

  const sequence = counter.currentNumber;
  const prefix = counter.prefix;
  const documentNumber = `${prefix}-${year}-${String(sequence).padStart(SEQUENCE_PADDING, "0")}`;

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

// ─── Función de consulta (sin efecto secundario) ──────────────────────────────

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
  await getDb()
    .update(documentCounters)
    .set({ prefix: newPrefix })
    .where(
      and(
        eq(documentCounters.documentType, documentType),
        eq(documentCounters.year, year)
      )
    );
}

/**
 * Resetea manualmente el contador a un valor específico (solo admin, con auditoría).
 * USAR CON EXTREMA PRECAUCIÓN — solo para correcciones de inicio de año.
 */
export async function resetCounter(
  documentType: DocumentType,
  year: number,
  newValue: number,
  resetBy: string
): Promise<void> {
  const db = getDb();
  await db
    .update(documentCounters)
    .set({ currentNumber: newValue })
    .where(
      and(
        eq(documentCounters.documentType, documentType),
        eq(documentCounters.year, year)
      )
    );

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
