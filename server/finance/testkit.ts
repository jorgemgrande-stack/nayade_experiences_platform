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

// ── Stripe (fase 2): migración e informes CSV SINTÉTICOS (identificadores y correos inventados, nunca datos reales) ──

export const MIGRATION_0036 = path.resolve(__dirname, "../../db/crm/migrations/0036_finance_stripe.sql");
export const MIGRATION_0037 = path.resolve(__dirname, "../../db/crm/migrations/0037_finance_tax.sql");
export const MIGRATION_0038 = path.resolve(__dirname, "../../db/crm/migrations/0038_finance_analysis.sql");

const csv = (rows: Array<Array<string | number>>) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(",")).join("\n");

/**
 * «Balance change from activity – itemized» de octubre de 2026 (columnas con los nombres del informe de Stripe):
 *  - txn_test_c1: cobro de la factura in_test_1 (121,00 €, comisión 3,88 €) liquidado en po_test_1;
 *  - txn_test_c2: cobro de in_test_2 (60,50 €) sin factura propia, y txn_test_r2 su reembolso total;
 *  - txn_test_f1: cargo de Stripe por otros servicios (1,50 €);
 *  - txn_test_p1: el payout po_test_1 (113,50 € = suma de los netos anteriores);
 *  - txn_test_d1 / txn_test_d2: disputa sobre el primer cobro (retención y 15 € de comisión) y su reversión (ganada);
 *  - txn_test_usd: cobro en dólares (se importa sin contabilizar); txn_test_t1: transferencia de Connect (no soportada).
 */
export function stripeBalanceSample() {
  return csv([
    ["balance_transaction_id", "created_utc", "available_on_utc", "currency", "gross", "fee", "net", "reporting_category", "source_id", "description", "customer_id", "customer_email", "charge_id", "payment_intent_id", "invoice_id", "automatic_payout_id", "automatic_payout_effective_at_utc"],
    ["txn_test_c1", "2026-10-05 10:00:00", "2026-10-07 00:00:00", "eur", "121.00", "3.88", "117.12", "charge", "ch_test_1", "Suscripción Elephant Core, octubre", "cus_test_1", "facturacion@cliente-a.example", "ch_test_1", "pi_test_1", "in_test_1", "po_test_1", "2026-10-08 00:00:00"],
    ["txn_test_c2", "2026-10-06 09:30:00", "2026-10-08 00:00:00", "eur", "60.50", "2.12", "58.38", "charge", "ch_test_2", "Cargo extraordinario", "cus_test_2", "pagos@cliente-b.example", "ch_test_2", "pi_test_2", "in_test_2", "po_test_1", "2026-10-08 00:00:00"],
    ["txn_test_r2", "2026-10-07 08:00:00", "2026-10-07 08:00:00", "eur", "-60.50", "0.00", "-60.50", "refund", "re_test_2", "Reembolso, cliente B", "cus_test_2", "pagos@cliente-b.example", "ch_test_2", "pi_test_2", "", "po_test_1", "2026-10-08 00:00:00"],
    ["txn_test_f1", "2026-10-07 12:00:00", "2026-10-07 12:00:00", "eur", "-1.50", "0.00", "-1.50", "fee", "", "Billing - Usage Fee (2026-10-01 - 2026-10-07)", "", "", "", "", "", "po_test_1", "2026-10-08 00:00:00"],
    ["txn_test_p1", "2026-10-08 01:00:00", "2026-10-08 01:00:00", "eur", "-113.50", "0.00", "-113.50", "payout", "po_test_1", "STRIPE PAYOUT", "", "", "", "", "", "", "2026-10-08 00:00:00"],
    ["txn_test_d1", "2026-10-20 16:00:00", "2026-10-20 16:00:00", "eur", "-121.00", "15.00", "-136.00", "dispute", "du_test_1", "Chargeback withdrawal for ch_test_1", "cus_test_1", "facturacion@cliente-a.example", "ch_test_1", "pi_test_1", "in_test_1", "po_test_2", "2026-10-28 00:00:00"],
    ["txn_test_d2", "2026-10-25 16:00:00", "2026-10-25 16:00:00", "eur", "121.00", "-15.00", "136.00", "dispute_reversal", "du_test_1", "Chargeback reversal for ch_test_1", "cus_test_1", "facturacion@cliente-a.example", "ch_test_1", "pi_test_1", "in_test_1", "po_test_2", "2026-10-28 00:00:00"],
    ["txn_test_usd", "2026-10-21 10:00:00", "2026-10-23 00:00:00", "usd", "10.00", "0.59", "9.41", "charge", "ch_test_usd", "Cobro en dólares", "cus_test_3", "", "ch_test_usd", "", "", "", ""],
    ["txn_test_t1", "2026-10-22 10:00:00", "2026-10-22 10:00:00", "eur", "-5.00", "0.00", "-5.00", "transfer", "tr_test_1", "Transferencia de Connect", "", "", "", "", "", "", ""],
  ]);
}

/** «Payouts – itemized»: po_test_1 pagado (STRIPE PAYOUT, 113,50 €) y po_test_9 fallido (con su fila de reversión). */
export function stripePayoutsSample() {
  return csv([
    ["payout_id", "effective_at_utc", "currency", "gross", "fee", "net", "reporting_category", "payout_expected_arrival_date", "payout_status", "payout_description"],
    ["po_test_1", "2026-10-08 00:00:00", "eur", "113.50", "0.00", "113.50", "payout", "2026-10-08", "paid", "STRIPE PAYOUT"],
    ["po_test_9", "2026-10-12 00:00:00", "eur", "40.00", "0.00", "40.00", "payout", "2026-10-12", "paid", "STRIPE PAYOUT"],
    ["po_test_9", "2026-10-13 00:00:00", "eur", "-40.00", "0.00", "-40.00", "payout_reversal", "2026-10-12", "failed", "STRIPE PAYOUT"],
  ]);
}

/** Export clásico del panel («Itemized balance transactions»): cabeceras con mayúsculas, espacios y paréntesis. */
export function stripeLegacySample() {
  return csv([
    ["id", "Type", "Source", "Amount", "Fee", "Net", "Currency", "Created (UTC)", "Available On (UTC)", "Description", "Transfer"],
    ["txn_test_l1", "charge", "ch_test_l1", "1,210.00", "17.19", "1,192.81", "eur", "2026-10-31 23:30", "2026-11-03 00:00", "Pago anual", "po_test_l"],
    ["txn_test_l2", "adjustment", "adj_test_1", "-50.00", "15.00", "-65.00", "eur", "2026-10-30 10:00", "2026-10-30 10:00", "Chargeback withdrawal for ch_test_l0", ""],
    ["txn_test_l3", "adjustment", "adj_test_2", "-2.00", "0.00", "-2.00", "eur", "2026-10-30 11:00", "2026-10-30 11:00", "Ajuste manual", ""],
    ["txn_test_l4", "charge", "ch_test_l4", "abc", "0.00", "0.00", "eur", "2026-10-30 11:00", "", "Fila rota", ""],
  ]);
}
