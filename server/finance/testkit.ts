/**
 * Utilidades de PRUEBA del libro contable: el plan contable y los diarios sembrados por la migración 0033, leídos del
 * propio fichero SQL (las pruebas en memoria usan exactamente la misma siembra que MySQL).
 */
import fs from "node:fs";
import path from "node:path";
import type { Account, AccountType, Journal, JournalCode } from "./types";

export const MIGRATION_0033 = path.resolve(__dirname, "../../db/crm/migrations/0033_finance_ledger.sql");

export function seededPlan(): { accounts: Array<Omit<Account, "id">>; journals: Journal[] } {
  const sql = fs.readFileSync(MIGRATION_0033, "utf8");
  const accounts = Array.from(sql.matchAll(/\('(\d{3,12})', '([^']+)', '(\w+)', (NULL|'\d+'), ([01]), ([01]), 0\)/g)).map((m) => ({
    code: m[1],
    name: m[2],
    type: m[3] as AccountType,
    parentCode: m[4] === "NULL" ? null : m[4].slice(1, -1),
    isPostable: m[5] === "1",
    active: m[6] === "1",
    createdAt: 0,
  }));
  const journals = Array.from(sql.matchAll(/\('([A-Z]{3})', '([^']+)'\)/g)).map((m) => ({ code: m[1] as JournalCode, name: m[2] }));
  return { accounts, journals };
}
