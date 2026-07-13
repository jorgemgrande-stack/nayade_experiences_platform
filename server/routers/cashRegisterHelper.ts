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

const _pool = mysql.createPool({ uri: process.env.DATABASE_URL!, connectionLimit: 1 });
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

export const CENTRAL_CASH_ACCOUNT_NAME = "Caja Central";

/**
 * Devuelve el id de la Caja Central (caja fuerte donde se consolida el efectivo
 * retirado de las cajas por seguridad). La crea si no existe. Idempotente.
 */
export async function getOrCreateCentralCashAccountId(): Promise<number> {
  const [existing] = await db
    .select({ id: finCashAccounts.id })
    .from(finCashAccounts)
    .where(eq(finCashAccounts.name, CENTRAL_CASH_ACCOUNT_NAME))
    .limit(1);
  if (existing) return existing.id;
  const [res] = await db.insert(finCashAccounts).values({
    name: CENTRAL_CASH_ACCOUNT_NAME,
    description: "Caja fuerte central donde se consolida el efectivo retirado de las cajas TPV por seguridad. Los traspasos no son gasto.",
    type: "secondary",
    currentBalance: "0.00",
    initialBalance: "0.00",
    isActive: true,
  });
  return (res as { insertId: number }).insertId;
}

/**
 * Traspaso interno de efectivo de una caja a la Caja Central.
 * NO es un gasto: el dinero no se pierde, cambia de caja (transfer_out + transfer_in
 * espejo). El total de efectivo del negocio se conserva.
 */
export async function recordCashTransferToCentral(params: {
  fromAccountId: number;
  amount: number;            // EUR positivo
  concept: string;
  notes?: string;
  createdBy?: number;
}): Promise<{ centralAccountId: number }> {
  const centralId = await getOrCreateCentralCashAccountId();
  const date = new Date().toISOString().slice(0, 10);

  // Salida de la caja origen
  await db.insert(finCashMovements).values({
    accountId: params.fromAccountId,
    date,
    type: "transfer_out",
    amount: String(params.amount),
    concept: params.concept,
    relatedEntityType: "manual",
    transferToAccountId: centralId,
    notes: params.notes,
    createdBy: params.createdBy,
  });
  await db.update(finCashAccounts)
    .set({ currentBalance: sql`current_balance - ${params.amount}` })
    .where(eq(finCashAccounts.id, params.fromAccountId));

  // Entrada espejo en la Caja Central
  await db.insert(finCashMovements).values({
    accountId: centralId,
    date,
    type: "transfer_in",
    amount: String(params.amount),
    concept: params.concept,
    relatedEntityType: "manual",
    transferToAccountId: params.fromAccountId,
    notes: params.notes,
    createdBy: params.createdBy,
  });
  await db.update(finCashAccounts)
    .set({ currentBalance: sql`current_balance + ${params.amount}` })
    .where(eq(finCashAccounts.id, centralId));

  return { centralAccountId: centralId };
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

