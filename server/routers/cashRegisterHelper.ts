/**
 * Helpers compartidos para el módulo Caja.
 * Importar desde crm.ts, expenses.ts y cashRegister.ts.
 * Siempre opera con try/catch para no bloquear flujos principales.
 */
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { finCashAccounts, finCashMovements } from "../../drizzle/schema";

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 3 });
const db = drizzle(_pool);

/** Devuelve el id de la cuenta de caja principal activa, o null si no existe. */
export async function getDefaultCashAccountId(): Promise<number | null> {
  const [acc] = await db
    .select({ id: finCashAccounts.id })
    .from(finCashAccounts)
    .where(and(
      eq(finCashAccounts.type, "principal"),
      eq(finCashAccounts.isActive, true),
    ))
    .limit(1);
  return acc?.id ?? null;
}

export interface CashMovementParams {
  accountId: number;
  date: string;             // YYYY-MM-DD
  type: "income" | "expense";
  amount: number;           // EUR positivo
  concept: string;
  relatedEntityType: "reservation" | "expense";
  relatedEntityId: number;
  createdBy?: number;
}

/**
 * Crea un movimiento de caja sólo si no existe ya uno para la misma entidad+tipo.
 * Es seguro llamarlo múltiples veces: es idempotente.
 */
export async function createCashMovementIfNotExists(
  params: CashMovementParams,
): Promise<{ created: boolean }> {
  // Deduplicación por entidad + tipo de movimiento
  const [existing] = await db
    .select({ id: finCashMovements.id })
    .from(finCashMovements)
    .where(and(
      eq(finCashMovements.relatedEntityType, params.relatedEntityType),
      eq(finCashMovements.relatedEntityId, params.relatedEntityId),
      eq(finCashMovements.type, params.type),
    ))
    .limit(1);

  if (existing) return { created: false };

  await db.insert(finCashMovements).values({
    accountId: params.accountId,
    date: params.date,
    type: params.type,
    amount: String(params.amount),
    concept: params.concept,
    relatedEntityType: params.relatedEntityType,
    relatedEntityId: params.relatedEntityId,
    createdBy: params.createdBy,
  });

  // Actualizar saldo cacheado
  const delta = params.type === "income" ? params.amount : -params.amount;
  await db
    .update(finCashAccounts)
    .set({ currentBalance: sql`current_balance + ${delta}` })
    .where(eq(finCashAccounts.id, params.accountId));

  return { created: true };
}

