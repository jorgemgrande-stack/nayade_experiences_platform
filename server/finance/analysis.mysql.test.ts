/**
 * Fase 4 contra MySQL real (opt-in, REGISTRY_TEST_DATABASE_URL; BD aislada creada y retirada aquí, con todas las
 * migraciones del CRM): el mismo escenario sintético que en memoria da EXACTAMENTE los mismos informes (cuenta de
 * resultados, balance, tesorería y previsión, antigüedad, gastos, Revenue & Margin, Conversion Health y control diario);
 * las agregaciones del libro salen agrupadas de la BD; revisión diaria única también con peticiones simultáneas; edición
 * de la nota sin pisarse; marca de coste directo persistente; tasa de pagos fallidos leída del registro comercial en
 * solo lectura (sin los avisos de impago y con meses de Madrid). Solo datos sintéticos.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { loadMigrations, splitStatements } from "../../scripts/db/migrationLib";
import { finAnalysisTablesReady, MysqlFinanceAnalysisStore, MysqlPaymentEventSource } from "./analysisStore";
import { analysisScenario, ANALYSIS_ACTOR as ACTOR } from "./analysisTestkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const DB = "finance_analysis_test";
const DIR = path.resolve(__dirname, "../../db/crm/migrations");

describe.skipIf(!URL_)("control diario, informes y análisis con MySQL real (CRM 0038)", () => {
  let admin: mysql.Pool;
  let pool: mysql.Pool;
  let my: Awaited<ReturnType<typeof analysisScenario>>;
  let mem: Awaited<ReturnType<typeof analysisScenario>>;
  const count = async (sql: string, args: unknown[] = []) => Number(((await pool.query<mysql.RowDataPacket[]>(sql, args))[0][0] as { n: number }).n);

  beforeAll(async () => {
    admin = mysql.createPool({ uri: URL_!, connectionLimit: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
    const u = new URL(URL_!);
    u.pathname = `/${DB}`;
    pool = mysql.createPool({ uri: u.toString(), connectionLimit: 10 });
    const ddl = fs.readFileSync(path.resolve(__dirname, "../../db/crm/0000_crm.sql"), "utf8").replace(/^--.*$/gm, "");
    for (const s of ddl.split(/;\s*(?:\r?\n|$)/).map((x) => x.trim()).filter(Boolean)) await pool.query(s);
    const migrations = loadMigrations(DIR).migrations;
    for (const m of migrations.filter((x) => x.id < "0038")) for (const s of splitStatements(m.up)) await pool.query(s);
    expect(await finAnalysisTablesReady(pool)).toBe(false);
    for (const m of migrations.filter((x) => x.id >= "0038")) for (const s of splitStatements(m.up)) await pool.query(s);
    expect(await finAnalysisTablesReady(pool)).toBe(true);
    my = await analysisScenario({ pool });
    mem = await analysisScenario();
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin?.end();
  });

  it("la migración 0038 añade las tablas, la columna (NULL en las categorías sembradas) y el índice de registro", async () => {
    expect(await count("SELECT COUNT(*) AS n FROM fin_expense_categories WHERE is_direct_cost IS NOT NULL")).toBe(0);
    const [idx] = await pool.query<mysql.RowDataPacket[]>("SHOW INDEX FROM fin_expenses WHERE Key_name = 'ix_fin_expense_registered'");
    expect(idx.length).toBe(1);
    const [uq] = await pool.query<mysql.RowDataPacket[]>("SHOW INDEX FROM fin_daily_reviews WHERE Key_name = 'uq_fin_daily_review_day'");
    expect(uq[0].Non_unique).toBe(0);
  });

  it("MySQL y memoria dan los mismos informes con el mismo escenario", async () => {
    const pairs: Array<[string, (s: typeof my) => Promise<unknown>]> = [
      ["pnl", (s) => s.analysis.pnl({ from: "2026-01-01", to: "2026-12-31", granularity: "month", compare: "year" })],
      ["pnl-quarter-cc", (s) => s.analysis.pnl({ from: "2026-07-01", to: "2026-12-31", granularity: "quarter", compare: "previous", costCenter: 1 })],
      ["balance", (s) => s.analysis.balance("2026-10-31")],
      ["balance-mid", (s) => s.analysis.balance("2026-10-06")],
      ["cashflow", (s) => s.analysis.cashflow({ from: "2026-01-01", to: "2026-10-31", forecastDays: 90 })],
      ["aging-payable", (s) => s.analysis.aging("payable", "2026-10-31")],
      ["aging-payable-past", (s) => s.analysis.aging("payable", "2026-10-05")],
      ["aging-receivable", (s) => s.analysis.aging("receivable", "2026-10-22")],
      ["expenses-category", (s) => s.analysis.expenses({ from: "2026-01-01", to: "2026-10-31", groupBy: "category", compare: "previous" })],
      ["expenses-supplier", (s) => s.analysis.expenses({ from: "2026-10-01", to: "2026-10-31", groupBy: "supplier" })],
      ["expenses-cc", (s) => s.analysis.expenses({ from: "2026-10-01", to: "2026-10-31", groupBy: "costCenter" })],
      ["revenue-margin", (s) => s.analysis.revenueMargin(2026)],
      ["conversion", (s) => s.analysis.conversion({ from: "2026-09-01", to: "2026-10-31" })],
      ["daily-31", async (s) => (await s.analysis.daily("2026-10-31")).counts],
      ["daily-08", async (s) => {
        const d = await s.analysis.daily("2026-10-08");
        return { counts: d.counts, bank: d.bank, stripe: d.stripe, payouts: d.payouts?.arriving.map(({ id: _i, entryId: _e, bankMovementId: _b, ...p }) => p) };
      }],
    ];
    for (const [name, run] of pairs) expect([name, await run(my)]).toEqual([name, await run(mem)]);
    // Y los informes cuadran también aquí
    expect((await my.analysis.balance("2026-10-31")).check.balanced).toBe(true);
    const c = await my.analysis.cashflow({ from: "2026-01-01", to: "2026-10-31", forecastDays: 0 });
    expect(c.totals.closingCents - c.totals.openingCents).toBe(c.totals.netCents);
  });

  it("las agregaciones del libro salen agrupadas de la BD (una fila por mes, cuenta y dimensiones)", async () => {
    const bank = my.bank.accountCode;
    for (let i = 0; i < 60; i++) await my.finance.createManual({ date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`, journal: "BAN", description: `Comisión ${i}`, lines: [{ accountCode: "626", debitCents: 100, creditCents: 0 }, { accountCode: bank, debitCents: 0, creditCents: 100 }], post: true }, ACTOR);
    const facts = await new MysqlFinanceAnalysisStore(pool).ledgerFacts({ from: "2026-06-01", to: "2026-06-30", accountPrefixes: ["626"] });
    expect(facts).toEqual([{ month: "2026-06", accountCode: "626", origin: "manual", costCenterId: null, supplierId: null, categoryId: null, debitCents: 6_000, creditCents: 0 }]);
    const treasury = await new MysqlFinanceAnalysisStore(pool).treasuryFacts("2026-06-01", "2026-06-30");
    expect(treasury).toEqual([{ month: "2026-06", accountCode: bank, internal: false, debitCents: 0, creditCents: 6_000 }]);
    // Las categorías del gasto llegan por su asiento y por la reversión de su asiento
    const cat = await new MysqlFinanceAnalysisStore(pool).ledgerFacts({ from: "2026-10-01", to: "2026-10-31", accountPrefixes: ["629"] });
    expect(cat.map((f) => [f.categoryId, f.supplierId, f.costCenterId, f.debitCents])).toEqual(expect.arrayContaining([[my.hostingCat.id, my.supplier.id, my.general.id, 50_000], [my.softwareCat.id, my.supplier.id, null, 10_000]]));
  });

  it("revisión diaria única con peticiones simultáneas; la nota se edita sin pisarse y queda en la bitácora", async () => {
    const outs = await Promise.all(Array.from({ length: 6 }, (_, i) => my.analysis.review("2026-10-29", i === 0 ? "Primera" : undefined, { by: `operator:op${i}`, requestId: `r${i}` })));
    expect(outs.filter((o) => o.created)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_daily_reviews WHERE review_day = '2026-10-29'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM fin_daily_review_log l JOIN fin_daily_reviews r ON r.id = l.review_id WHERE r.review_day = '2026-10-29' AND l.action = 'review'")).toBe(1);
    // Si la petición con nota no fue la que creó la fila, su nota entra como edición: en todo caso queda «Primera»
    const first = (await my.analysis.daily("2026-10-29")).review!;
    expect(first.note).toBe("Primera");
    const notesBefore = first.log.filter((l) => l.action === "note").length;
    const results = await Promise.allSettled(["Nota A", "Nota B", "Nota C"].map((n, i) => my.analysis.review("2026-10-29", n, { by: `operator:ed${i}`, requestId: null })));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBeGreaterThanOrEqual(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "conflict" });
    const day = (await my.analysis.daily("2026-10-29")).review!;
    expect(["Nota A", "Nota B", "Nota C"]).toContain(day.note);
    expect(day.log.filter((l) => l.action === "note")).toHaveLength(notesBefore + ok);
    // Cada edición enlaza con la anterior (la bitácora es una cadena sin saltos)
    const notes = day.log.map((l) => [l.noteBefore, l.noteAfter]);
    for (let i = 1; i < notes.length; i++) expect(notes[i][0]).toBe(notes[i - 1][1]);
    // Fecha sin desplazamiento de zona horaria
    const [row] = await pool.query<mysql.RowDataPacket[]>("SELECT DATE_FORMAT(review_day, '%Y-%m-%d') AS d FROM fin_daily_reviews");
    expect(row[0].d).toBe("2026-10-29");
    expect((await my.analysis.reviews({ from: "2026-10-01" })).items.map((r) => r.day)).toEqual(["2026-10-29"]);
    expect(await count("SELECT COUNT(*) AS n FROM fin_audit_log WHERE action = 'daily.review'")).toBe(1);
  });

  it("marca de coste directo persistente; GET de categorías la resuelve; afecta al margen", async () => {
    const before = (await my.analysis.revenueMargin(2026)).months[9];
    await my.analysis.setDirectCost(my.softwareCat.id, true, ACTOR);
    expect(await count("SELECT COUNT(*) AS n FROM fin_expense_categories WHERE is_direct_cost = 1")).toBe(1);
    const after = (await my.analysis.revenueMargin(2026)).months[9];
    expect(after.directCostsCents - before.directCostsCents).toBe(10_000);
    await my.analysis.setDirectCost(my.softwareCat.id, null, ACTOR);
    const cats = await my.analysis.decorateCategories(await my.opsStore.listCategories());
    expect(cats.find((c) => c.id === my.softwareCat.id)).toMatchObject({ isDirectCost: null, directCost: false });
    expect(cats.filter((c) => c.directCost).map((c) => c.accountCode).sort()).toEqual(["626", "626", "629"]);
    await expect(my.analysis.setDirectCost(9_999, true, ACTOR)).rejects.toMatchObject({ code: "not_found" });
  });

  it("pagos fallidos del registro comercial en solo lectura: entorno, meses de Madrid y sin avisos de impago", async () => {
    let n = 0;
    const ev = (type: string, at: string, environment = "test") =>
      pool.query("INSERT INTO commercial_events (event_key, type, schema_version, environment, source, actor, correlation_id, aggregate_type, aggregate_id, occurred_at) VALUES (?, ?, 1, ?, 'stripe', 'system', 'order:1', 'payment', ?, ?)", [`k${++n}`, type, environment, String(n), Date.parse(at)]);
    await ev("payment.succeeded", "2026-10-03T10:00:00Z");
    await ev("renewal.paid", "2026-10-10T10:00:00Z");
    await ev("renewal.failed", "2026-10-11T10:00:00Z");
    await ev("order.dunning_notice", "2026-10-12T10:00:00Z");
    await ev("payment.failed", "2026-09-30T22:30:00Z"); // 1 de octubre a las 00:30 en Madrid
    await ev("payment.failed", "2026-10-15T10:00:00Z", "live");
    const src = new MysqlPaymentEventSource(pool, "test");
    expect(await src.monthly("2026-09-01", "2026-10-31")).toEqual([{ month: "2026-10", failed: 2, succeeded: 2 }]);
    expect(await new MysqlPaymentEventSource(pool, "live").monthly("2026-10-01", "2026-10-31")).toEqual([{ month: "2026-10", failed: 1, succeeded: 0 }]);
    const conv = await my.analysis.conversion({ from: "2026-10-01", to: "2026-10-31" });
    expect(conv.months[0].failedPayments).toBeNull();
    const { FinanceAnalysisService } = await import("./analysisService");
    const svc = new FinanceAnalysisService({ store: new MysqlFinanceAnalysisStore(pool), finance: my.finance, ledger: my.ledger, ops: my.opsStore, paymentEvents: src, now: () => Date.UTC(2026, 9, 31, 10) });
    expect((await svc.conversion({ from: "2026-10-01", to: "2026-10-31" })).months[0].failedPayments).toEqual({ failed: 2, succeeded: 2, ratePct: 50 });
    // Sin la tabla (otro esquema), null y no un error
    expect(await new MysqlPaymentEventSource({ query: async () => Promise.reject(new Error("no existe")) } as never, "test").monthly("2026-10-01", "2026-10-31")).toBeNull();
  });
});
