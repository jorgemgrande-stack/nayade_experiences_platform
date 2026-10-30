/**
 * Libro contable contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y retirada aquí, con todas
 * las migraciones del CRM): siembra de 0033, numeración correlativa con contabilizaciones simultáneas, idempotencia por
 * `source_key` también en carrera, periodos cerrados, reversión enlazada, restricción debe XOR haber, fechas sin
 * desplazamiento de zona, sincronización de facturas expedidas reales, cierre del ejercicio y auditoría.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { lineOf, totals } from "../invoicing/rules";
import { MysqlInvoicingStore } from "../invoicing/store";
import type { FiscalParty } from "../invoicing/types";
import { FinanceService } from "./service";
import { MysqlFinanceStore, finTablesReady } from "./store";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "finance_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");
const T = Date.UTC(2026, 9, 30, 10);
const ACTOR = { by: "operator:luis", requestId: "req-mysql" };
const PARTY: FiscalParty = { legalName: "NEXTAIR SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "28001", city: "Madrid", country: "ES" };
const D = (accountCode: string, c: number) => ({ accountCode, debitCents: c, creditCents: 0 });
const H = (accountCode: string, c: number) => ({ accountCode, debitCents: 0, creditCents: c });

describe.skipIf(!URL_)("libro contable con MySQL real (CRM 0033)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let store: MysqlFinanceStore;
  let invoices: MysqlInvoicingStore;
  let svc: FinanceService;

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 8 });
    expect(await finTablesReady(pool)).toBe(false);
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const all = loadMigrations(DIR).migrations;
    expect(all.map((m) => m.id)).toContain("0033_finance_ledger");
    for (const m of all) for (const s of splitStatements(m.up)) await pool.query(s);
    store = new MysqlFinanceStore(pool);
    invoices = new MysqlInvoicingStore(pool, "test");
    svc = new FinanceService({ store, invoices, now: () => T });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("siembra del plan y los diarios; alta de ejercicio con doce periodos", async () => {
    expect(await finTablesReady(pool)).toBe(true);
    const accounts = await svc.accounts();
    expect(accounts).toHaveLength(58);
    expect(accounts.find((a) => a.code === "4751")).toMatchObject({ type: "liability", parentCode: "475", isPostable: true, active: true });
    expect((await svc.journals()).map((j) => j.code)).toEqual(["GEN", "VEN", "COM", "BAN", "CAJ", "STR", "NOM", "IMP", "APE", "REG", "CIE"]);
    const fy = await svc.createFiscalYear(2026, ACTOR);
    expect(fy.periods.map((p) => [p.month, p.status])).toEqual(Array.from({ length: 12 }, (_, i) => [i + 1, "open"]));
    await expect(svc.createFiscalYear(2026, ACTOR)).rejects.toMatchObject({ code: "conflict" });
  });

  it("numeración correlativa sin huecos con contabilizaciones simultáneas; fechas sin desplazamiento", async () => {
    const made = await Promise.all(Array.from({ length: 12 }, (_, i) => svc.createManual({ date: "2026-12-31", journal: "COM", description: `Gasto ${i}`, lines: [D("629", 100 + i), H("410", 100 + i)], post: true }, ACTOR)));
    expect(made.map((e) => e.number).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(made.every((e) => e.date === "2026-12-31" && e.year === 2026 && e.status === "posted")).toBe(true);
    const lines = await store.postedLines({ from: "2026-12-31", to: "2026-12-31" });
    expect(lines).toHaveLength(24);
    expect(lines[0].date).toBe("2026-12-31");
  });

  it("un asiento por hecho económico también con peticiones simultáneas", async () => {
    const draft = { journalCode: "COM" as const, date: "2026-07-01", description: "Factura recibida F-9", origin: "expense" as const, sourceKey: "expense:9", lines: [D("629", 1_000), D("472", 210), H("410", 1_210)] };
    const out = await Promise.all(Array.from({ length: 6 }, () => svc.postGenerated(draft, ACTOR)));
    expect(out.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(out.map((r) => r.entry.id)).size).toBe(1);
    expect((await svc.listEntries({ q: "expense:9" })).total).toBe(1);
  });

  it("periodo cerrado rechaza; borrador → contabilizado; reversión enlazada e idempotente en carrera", async () => {
    await svc.setPeriodStatus(2026, 3, "closed", ACTOR);
    await expect(svc.createManual({ date: "2026-03-05", journal: "GEN", description: "x", lines: [D("629", 1), H("410", 1)], post: true }, ACTOR)).rejects.toMatchObject({ code: "period_closed" });
    const draft = await svc.createManual({ date: "2026-03-05", journal: "GEN", description: "Borrador marzo", lines: [D("629", 500), H("410", 500)] }, ACTOR);
    await expect(svc.post(draft.id, ACTOR)).rejects.toMatchObject({ code: "period_closed" });
    await svc.setPeriodStatus(2026, 3, "open", ACTOR);
    const posted = await svc.post(draft.id, ACTOR);
    expect(posted).toMatchObject({ status: "posted", number: 14, postedBy: "operator:luis" });
    const rs = await Promise.all([1, 2, 3].map(() => svc.reverse(draft.id, { date: "2026-03-06", reason: "Error" }, ACTOR)));
    expect(rs.filter((r) => r.created)).toHaveLength(1);
    const orig = await svc.getEntry(draft.id);
    expect(orig.reversedByEntryId).toBe(rs[0].entry.id);
    expect(rs[0].entry).toMatchObject({ reversesEntryId: draft.id, origin: "reversal", date: "2026-03-06" });
    const v = await svc.createManual({ date: "2026-03-07", journal: "GEN", description: "Para anular", lines: [D("629", 1), H("410", 1)] }, ACTOR);
    expect((await svc.voidDraft(v.id, "Sobra", ACTOR)).status).toBe("void");
    await expect(svc.voidDraft(draft.id, "No", ACTOR)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("la BD impide líneas con debe y haber a la vez", async () => {
    const [[e]] = (await pool.query("SELECT id FROM fin_entries ORDER BY id LIMIT 1")) as unknown as [[{ id: number }]];
    await expect(pool.query("INSERT INTO fin_entry_lines (entry_id, line_no, account_code, debit_cents, credit_cents) VALUES (?, 99, '629', 1, 1)", [e.id])).rejects.toThrow();
    await expect(pool.query("INSERT INTO fin_entry_lines (entry_id, line_no, account_code, debit_cents, credit_cents) VALUES (?, 98, '999', 1, 0)", [e.id])).rejects.toThrow();
  });

  it("cuenta exacta frente a cuenta de mayor: 5720 (Stripe) no incluye los bancos 572000NN", async () => {
    expect(await svc.createAccount({ code: "57200001", name: "Banco principal" }, ACTOR)).toMatchObject({ parentCode: "572" });
    await svc.createManual({ date: "2026-08-01", journal: "BAN", description: "Traspaso", lines: [D("57200001", 7_000), H("5720", 7_000)], post: true }, ACTOR);
    expect((await svc.ledger("5720", "2026-01-01", "2026-12-31")).closingCents).toBe(-7_000);
    expect((await svc.ledger("57200001", "2026-01-01", "2026-12-31")).closingCents).toBe(7_000);
    expect((await svc.ledger("572", "2026-01-01", "2026-12-31")).closingCents).toBe(0);
    expect((await svc.listEntries({ account: "5720" })).total).toBe(1);
    expect((await svc.listEntries({ account: "572", journal: "BAN" })).total).toBe(1);
  });

  it("sincroniza facturas expedidas reales una sola vez", async () => {
    const lines = [lineOf(1, "Plan", 1, 100_000, 2100), lineOf(2, "Curso", 1, 20_000, 1000)];
    const { invoice } = await invoices.insertDraft({ sourceKey: "external:5:2026-09", kind: "invoice", paymentStatus: "pending", companyId: 3, billingRef: "external:5", paymentRef: null, originalInvoiceId: null, operationDate: "2026-09-01", periodStart: null, periodEnd: null, periodLabel: null, currency: "EUR", ...totals(lines), customer: PARTY, notes: null, createdBy: "t", createdAt: T, lines });
    await invoices.issue({ id: invoice.id, seriesCode: "EB", issueDate: "2026-09-02", issuer: PARTY, customer: PARTY, issuedBy: "t", issuedAt: T });
    expect(await svc.syncInvoices(ACTOR)).toEqual({ posted: 1, skipped: 0, errors: [], truncated: false });
    expect(await svc.syncInvoices(ACTOR)).toEqual({ posted: 0, skipped: 1, errors: [], truncated: false });
    const e = (await store.bySource(`invoice:${invoice.id}`))!;
    expect(e).toMatchObject({ journalCode: "VEN", date: "2026-09-02", origin: "invoice", status: "posted" });
    expect(e.lines.map((l) => [l.accountCode, l.debitCents, l.creditCents, l.taxRateBp, l.companyId])).toEqual([
      ["430", 143_000, 0, null, 3],
      ["705", 0, 100_000, 2100, 3],
      ["705", 0, 20_000, 1000, 3],
      ["477", 0, 21_000, 2100, 3],
      ["477", 0, 2_000, 1000, 3],
    ]);
    expect(await svc.syncStatus()).toEqual({ lastRunAt: T, lastRunBy: "operator:luis", pending: 0, synced: 1, lastResult: { posted: 0, skipped: 1, errors: 0, truncated: false } });
  });

  it("cierre del ejercicio: regularización, cierre y apertura una sola vez", async () => {
    for (let m = 1; m <= 12; m++) await svc.setPeriodStatus(2026, m, "closed", ACTOR);
    const [a, b] = await Promise.all([svc.closeFiscalYear(2026, ACTOR), svc.closeFiscalYear(2026, ACTOR)].map((p) => p.catch((e) => e)));
    const ok = [a, b].filter((x) => x && x.fiscalYear);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await svc.closeFiscalYear(2026, ACTOR);
    expect(again.alreadyClosed).toBe(true);
    expect(again.fiscalYear.status).toBe("closed");
    const [[c]] = (await pool.query("SELECT COUNT(*) AS n FROM fin_entries WHERE origin IN ('regularization','closing','opening')")) as unknown as [[{ n: number }]];
    expect(Number(c.n)).toBe(3);
    expect((await svc.trialBalance("2026-01-01", "2026-12-31")).items.every((r) => r.balanceCents === 0)).toBe(true);
    const tb2027 = await svc.trialBalance("2027-01-01", "2027-01-31");
    expect(tb2027.totals.debitCents).toBe(tb2027.totals.creditCents);
    expect(again.opening).toMatchObject({ year: 2027, number: 1, journalCode: "APE" });
    await expect(svc.setPeriodStatus(2026, 1, "open", ACTOR)).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("auditoría: una fila por escritura con actor, correlación y resumen JSON", async () => {
    const [rows] = (await pool.query("SELECT action, actor, request_id, summary FROM fin_audit_log ORDER BY id")) as unknown as [Array<{ action: string; actor: string; request_id: string; summary: unknown }>];
    expect(rows.length).toBeGreaterThan(30);
    expect(rows.every((r) => r.actor === "operator:luis" && r.request_id === "req-mysql")).toBe(true);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["fiscal_year.create", "entry.create_posted", "entry.generate", "period.close", "period.reopen", "entry.post", "entry.reverse", "entry.void", "account.create", "sync.invoices", "fiscal_year.close"]) expect(actions.has(a)).toBe(true);
    const last = await store.lastAudit("sync.invoices");
    expect(last?.summary).toEqual({ posted: 0, skipped: 1, errors: 0, truncated: false });
  });
});
