/**
 * Cobro de cargos contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada con todas las migraciones del CRM):
 * alta, búsqueda por sesión, actualización de estado y entornos separados (CRM 0029).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { MysqlChargePaymentStore } from "./chargePayments";
import { receiptsOnFinanceDocuments } from "./transferReceipts";
import { MysqlFinanceOpsStore } from "../finance/opsStore";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "charge_payments_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const T = Date.UTC(2026, 10, 15, 9);

describe.skipIf(!URL_)("cobro de cargos con MySQL real (CRM 0029)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 4 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const all = loadMigrations(DIR).migrations;
    expect(all.map((m) => m.id)).toContain("0029_charge_payments");
    for (const m of all) for (const s of splitStatements(m.up)) await pool.query(s);
  });

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("alta, búsqueda por sesión, cobro registrado y entornos separados", async () => {
    const test = new MysqlChargePaymentStore(pool, "test");
    const live = new MysqlChargePaymentStore(pool, "live");
    const p = await test.insert({ chargeId: 3, kind: "stripe_link", status: "open", amountCents: 50_000, totalCents: 60_500, currency: "EUR", stripeSessionId: "cs_test_1", stripePaymentIntentId: null, reference: null, expiresAt: T + 3_600_000, createdBy: "operator:ana", createdAt: T, paidAt: null });
    expect(p).toMatchObject({ chargeId: 3, status: "open", totalCents: 60_500 });
    expect((await test.bySession("cs_test_1"))?.id).toBe(p.id);
    expect(await live.bySession("cs_test_1")).toBeNull();
    const paid = await test.update(p.id, { status: "paid", stripePaymentIntentId: "pi_1", paidAt: T + 60_000 }, T + 60_000);
    expect(paid).toMatchObject({ status: "paid", stripePaymentIntentId: "pi_1", paidAt: T + 60_000 });
    await test.insert({ chargeId: 3, kind: "offline", status: "paid", amountCents: 50_000, totalCents: 60_500, currency: "EUR", stripeSessionId: null, stripePaymentIntentId: null, reference: "TRF-1", expiresAt: null, createdBy: "operator:jefa", createdAt: T + 1, paidAt: T + 1 });
    expect((await test.byCharge(3)).map((x) => x.kind)).toEqual(["offline", "stripe_link"]);
    expect(await live.byCharge(3)).toEqual([]);
  });

  it("0050: transferencia que liquida el cargo una sola vez, idempotencia, cobro de Stripe a la vez, anulación y justificante en fin_documents", async () => {
    const test = new MysqlChargePaymentStore(pool, "test", { transfers: true });
    const live = new MysqlChargePaymentStore(pool, "live", { transfers: true });
    const tr = (key: string | null, chargeId = 40) => ({ chargeId, amountCents: 148_760, totalCents: 180_000, currency: "EUR", reference: "TRF 1800", method: "bank_transfer" as const, receiptDocumentId: 1, idempotencyKey: key, createdBy: "operator:jorge", createdAt: T, paidAt: T });
    // Dos confirmaciones a la vez con claves distintas: solo una liquida el cargo
    const [a, b] = await Promise.all([test.insertSettled(tr("k-a-000001")), test.insertSettled(tr("k-b-000001"))]);
    expect([a, b].filter((r) => "conflict" in r)).toHaveLength(1);
    const won = ([a, b].find((r) => !("conflict" in r)) as { payment: { id: number; settlesChargeId?: number | null; method?: string | null } }).payment;
    expect(won).toMatchObject({ settlesChargeId: 40, method: "bank_transfer", status: "paid", receiptDocumentId: 1 });
    // Mismo envío repetido: el mismo pago
    const key = (won as { idempotencyKey?: string }).idempotencyKey!;
    expect(await test.insertSettled(tr(key))).toMatchObject({ created: false, payment: { id: won.id } });
    expect((await test.settledOf(40))?.id).toBe(won.id);
    // Un cobro de Stripe del mismo cargo no puede liquidarlo también
    const link = await test.insert({ chargeId: 40, kind: "stripe_link", status: "cancelled", amountCents: 148_760, totalCents: 180_000, currency: "EUR", stripeSessionId: "cs_test_40", stripePaymentIntentId: null, reference: null, expiresAt: T + 1, createdBy: "operator:ana", createdAt: T, paidAt: null });
    expect(await test.settle(link.id, { stripePaymentIntentId: "pi_40", paidAt: T + 5 }, 40, T + 5)).toBe(false);
    expect((await test.byId(link.id))!.status).toBe("cancelled");
    // Otro entorno no ve ni choca con este
    expect(await live.settledOf(40)).toBeNull();
    expect(await live.insertSettled(tr(key))).toMatchObject({ created: true });
    // Rectificación y anulación: la fila se conserva y deja de liquidar el cargo
    expect(await test.amend(won.id, { paidAt: T - 86_400_000, reference: "TRF corregida" }, T + 9)).toMatchObject({ paidAt: T - 86_400_000, reference: "TRF corregida" });
    expect(await test.release(won.id, { voidedAt: T + 10, voidedBy: "operator:jorge", voidReason: "Nota equivocada" }, T + 10)).toMatchObject({ status: "voided", settlesChargeId: null, voidReason: "Nota equivocada" });
    expect(await test.settle(link.id, { stripePaymentIntentId: "pi_40", paidAt: T + 11 }, 40, T + 11)).toBe(true);
    expect((await test.paidBetween(T, T + 20)).filter((p) => p.chargeId === 40).map((p) => p.id)).toEqual([link.id]);
    // Sin la 0050 (columnas), el almacén no registra transferencias
    await expect(new MysqlChargePaymentStore(pool, "test").insertSettled(tr("k-c-000001", 41))).rejects.toMatchObject({ code: "unavailable" });

    // Justificante en el almacén privado de las finanzas (fin_documents), con su tipo propio
    const docs = receiptsOnFinanceDocuments(new MysqlFinanceOpsStore(pool));
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
    const d = await docs.put(40, { filename: "transferencia.pdf", content: pdf, sha256: "a".repeat(64) }, "operator:jorge", T);
    expect(await docs.get(d.id)).toMatchObject({ chargeId: 40, mime: "application/pdf", sizeBytes: pdf.length });
    expect((await docs.content(d.id))!.equals(pdf)).toBe(true);
    const [[row]] = await pool.query<mysql.RowDataPacket[]>("SELECT owner_type, owner_id FROM fin_documents WHERE id = ?", [d.id]);
    expect(row).toMatchObject({ owner_type: "charge_receipt", owner_id: 40 });
  });

  it("la migración 0050 es aditiva y deja igual las filas anteriores", async () => {
    const up = fs.readFileSync(path.join(DIR, "0050_charge_payment_transfers.sql"), "utf8").replace(/^--.*$/gm, "");
    expect(up).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\S+\s+SET|MODIFY|RENAME)\b/i);
    const [[old]] = await pool.query<mysql.RowDataPacket[]>("SELECT method, settles_charge_id, idempotency_key FROM billing_charge_payments WHERE stripe_session_id = 'cs_test_1'");
    expect(old).toMatchObject({ method: null, settles_charge_id: null, idempotency_key: null });
  });
});
