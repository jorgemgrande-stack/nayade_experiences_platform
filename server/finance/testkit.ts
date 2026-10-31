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

export const MIGRATION_0035 = path.resolve(__dirname, "../../db/crm/migrations/0035_finance_operations.sql");

/** Centros de coste y categorías sembrados por la migración 0035, leídos del propio fichero SQL. */
export function seededOps(): { costCenters: Array<{ code: string; name: string; active: boolean }>; categories: Array<{ name: string; accountCode: string; defaultTaxRateBp: number | null; active: boolean }> } {
  const sql = fs.readFileSync(MIGRATION_0035, "utf8");
  const costCenters = Array.from(sql.matchAll(/\('([A-Z0-9_-]+)', '([^']+)', ([01]), 0\)/g)).map((m) => ({ code: m[1], name: m[2], active: m[3] === "1" }));
  const categories = Array.from(sql.matchAll(/\('([^']+)', '(6\d{2})', (\d+|NULL), ([01]), 0\)/g)).map((m) => ({ name: m[1], accountCode: m[2], defaultTaxRateBp: m[3] === "NULL" ? null : Number(m[3]), active: m[4] === "1" }));
  return { costCenters, categories };
}

// ── Norma 43 de prueba (registros de 80 posiciones) ──────────────────────────────────────────────────────────────

const pad = (s: string | number, n: number, c = " ") => String(s).padEnd(n, c).slice(0, n);
const zero = (v: number, n: number) => String(v).padStart(n, "0");
const r11 = (o: { open: number; from?: string; to?: string }) => `11${"2100"}${"0418"}${"0200051332"}${o.from ?? "261001"}${o.to ?? "261031"}${o.open < 0 ? "1" : "2"}${zero(Math.abs(o.open), 14)}978${"3"}${pad("IRON ELEPHANT CONSULTING", 26)}${"   "}`;
const r22 = (o: { date: string; amount: number; common?: string; doc?: string; ref1?: string; ref2?: string }) => `22${"    "}${"0418"}${o.date}${o.date}${o.common ?? "17"}${"000"}${o.amount < 0 ? "1" : "2"}${zero(Math.abs(o.amount), 14)}${zero(Number(o.doc ?? 0), 10)}${pad(o.ref1 ?? "", 12)}${pad(o.ref2 ?? "", 16)}`;
const r23 = (code: string, a: string, b = "") => `23${code}${pad(a, 38)}${pad(b, 38)}`;
const r33 = (o: { nd: number; d: number; nc: number; c: number; close: number }) => `33${"2100"}${"0418"}${"0200051332"}${zero(o.nd, 5)}${zero(o.d, 14)}${zero(o.nc, 5)}${zero(o.c, 14)}${o.close < 0 ? "1" : "2"}${zero(Math.abs(o.close), 14)}978${"    "}`;
const r88 = (n: number) => `88${"9".repeat(18)}${zero(n, 6)}${" ".repeat(54)}`;

/** Extracto Norma 43 de ejemplo (cuenta ES9121000418450200051332, octubre de 2026). */
export function norma43Sample() {
  return [
    r11({ open: 500_000 }),
    r22({ date: "261002", amount: -350, common: "17", ref2: "COMISION MANT" }),
    r23("01", "COMISION MANTENIMIENTO CUENTA"),
    r22({ date: "261005", amount: -121_000, common: "04", ref1: "F-2026-10", ref2: "" }),
    r23("01", "TRANSF A HOSTING NUBE SL", "FACTURA F-2026-10"),
    r22({ date: "261005", amount: 250_000, common: "02", ref2: "COBRO CLIENTE" }),
    r22({ date: "261005", amount: -350, common: "17", ref2: "COMISION MANT" }),
    r23("01", "COMISION MANTENIMIENTO CUENTA"),
    r33({ nd: 3, d: 121_700, nc: 1, c: 250_000, close: 628_300 }),
    r88(10),
  ].join("\r\n");
}

export const n43 = { r11, r22, r23, r33, r88 };
