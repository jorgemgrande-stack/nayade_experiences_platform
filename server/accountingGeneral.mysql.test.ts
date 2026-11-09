/**
 * Contabilidad general con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas nuevas
 * desde la baseline y las migraciones de empresa (incluida la 0060). Licencia accounting-general (sin ella y en solo
 * lectura), solo administración, plan de cuentas sembrado al empezar, asientos automáticos de una factura cobrada, un
 * abono, un ticket de caja, un gasto con IVA y retención, su pago y un cierre de caja con descuadre; idempotencia
 * (repetir y dos generaciones a la vez no duplican), corrección al cambiar un gasto, reversión al anular una factura,
 * asientos manuales con cuadre obligatorio, bloqueo de periodo, libros, exportaciones y aislamiento entre empresas.
 * TEST_MIGRATIONS_DIR permite apuntar a una copia del carril sin huecos mientras se fusionan las anteriores.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as XLSX from "xlsx";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "accounting-general";
const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
const year = () => Number(today().slice(0, 4));
/** Mediodía en Madrid de una fecha (para los instantes del Core). */
const noon = (d: string) => new Date(`${d}T10:00:00Z`);

describe.skipIf(!URL_)("Contabilidad general · asientos automáticos, manuales, libros y aislamiento (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  const y = () => year();
  const d1 = () => `${y()}-01-15`;
  const d2 = () => `${y()}-01-20`;

  const m = (proc: string, input: unknown, cookie = adA, co: "a" | "b" = "a") => ess.m(co, `accountingGeneral.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: "a" | "b" = "a") => ess.q(co, `accountingGeneral.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const period = () => ({ from: `${y()}-01-01`, to: `${y()}-12-31` });
  const balance = async (code: string, co: "a" | "b" = "a") => {
    const tb = await ok(q("trialBalance", period(), co === "a" ? adA : adB, co));
    return tb.items.filter((r: any) => r.code === code).reduce((a: number, r: any) => a + r.balanceCents, 0);
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "contab");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la capacidad accounting-general no responde (403 de licencia)", async () => {
    expect(isLicenseDenied(await q("overview"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("sync", undefined), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("solo la administración", async () => {
    expect(errCode(await q("overview", undefined, agA))).toBe("FORBIDDEN");
  });

  it("las consultas no escriben (también en solo lectura); la primera mutación siembra el plan de cuentas y los ajustes (inicio: 1 de enero)", async () => {
    await ess.setCapability("a", CAP, "read_only");
    for (const proc of ["overview", "accounts", "settings"]) expect((await q(proc)).status).toBe(200);
    expect((await q("trialBalance", period())).status).toBe(200);
    expect((await q("ledger", { ...period(), account: "430" })).status).toBe(200);
    expect((await q("export", { ...period(), kind: "workbook" })).status).toBe(200);
    await ess.setCapability("a", CAP, "active");
    const o = await ok(q("overview"));
    expect(o.settings.startDate).toBe(`${y()}-01-01`);
    expect(o.counts.entries).toBe(0);
    const accounts = await ok(q("accounts"));
    for (const c of ["430", "700", "477", "472", "410", "570", "572", "4751", "129"]) expect(accounts.map((a: any) => a.code)).toContain(c);
    const written = async () => (await ess.sql("a", "SELECT (SELECT COUNT(*) FROM acc_settings) + (SELECT COUNT(*) FROM acc_accounts) AS n"))[0].n;
    expect(Number(await written())).toBe(0); // nada escrito por las consultas
    // Subcuenta: hereda el tipo
    const sub = await ok(m("createAccount", { code: "57200001", name: "Banco QA" }));
    expect(sub).toMatchObject({ parentCode: "572", type: "asset" });
    expect(errCode(await m("createAccount", { code: "57200001", name: "Otra" }))).toBe("CONFLICT");
  });

  it("documentos del Core → asientos automáticos que cuadran (factura cobrada, abono, ticket, gasto, pago, cierre de caja)", async () => {
    const at = noon(d1());
    // Factura cobrada por transferencia (21 %: 100 + 21) y abono parcial (−10 − 2,10)
    await ess.sql("a", `INSERT INTO invoices (invoiceNumber, clientName, clientEmail, subtotal, taxRate, taxAmount, taxBreakdown, total, status, invoiceType, paymentMethod, issuedAt)
      VALUES ('F-QA-1', 'Cliente QA', 'qa@example.com', 100.00, 21, 21.00, '[{"rate":21,"base":100,"amount":21}]', 121.00, 'cobrada', 'factura', 'transferencia', ?)`, [at]);
    const [inv] = await ess.sql("a", "SELECT id FROM invoices WHERE invoiceNumber = 'F-QA-1'");
    await ess.sql("a", `INSERT INTO invoices (invoiceNumber, clientName, clientEmail, subtotal, taxRate, taxAmount, taxBreakdown, total, status, invoiceType, creditNoteForId, issuedAt)
      VALUES ('A-QA-1', 'Cliente QA', 'qa@example.com', -10.00, 21, -2.10, '[{"rate":21,"base":10,"amount":2.1}]', -12.10, 'generada', 'abono', ?, ?)`, [inv.id, at]);
    // Ticket de caja de 24,20 € (21 %) cobrado en efectivo, y la sesión cerrada con 0,50 € de faltante
    await ess.sql("a", "INSERT INTO cash_registers (name, createdAt) VALUES ('Caja QA', ?)", [Date.now()]);
    const [reg] = await ess.sql("a", "SELECT id FROM cash_registers WHERE name = 'Caja QA'");
    await ess.sql("a", "INSERT INTO cash_sessions (registerId, cashierUserId, cashierName, status_cs, cashDifference, openedAt, closedAt) VALUES (?, 1, 'Cajero', 'closed', -0.50, ?, ?)", [reg.id, at.getTime(), at.getTime() + 3600_000]);
    const [ses] = await ess.sql("a", "SELECT id FROM cash_sessions ORDER BY id DESC LIMIT 1");
    await ess.sql("a", "INSERT INTO tpv_sales (ticketNumber, sessionId, subtotal, total, status_ts, createdAt, paidAt) VALUES ('T-QA-1', ?, 24.20, 24.20, 'paid', ?, ?)", [ses.id, at.getTime(), at.getTime()]);
    const [sale] = await ess.sql("a", "SELECT id FROM tpv_sales WHERE ticketNumber = 'T-QA-1'");
    await ess.sql("a", "INSERT INTO tpv_sale_items (saleId, productType_tsi, productId, productName, unitPrice, subtotal_tsi, fiscalRegime_tsi, taxRate_tsi) VALUES (?, 'experience', 1, 'Actividad', 24.20, 24.20, 'general', 21)", [sale.id]);
    await ess.sql("a", "INSERT INTO tpv_sale_payments (saleId, method_tsp, amount_tsp, status_tsp, createdAt) VALUES (?, 'cash', 24.20, 'completed', ?)", [sale.id, at.getTime()]);
    // Gasto de 121 € (IVA 21 € deducible) con 15 € de retención, pagado por transferencia
    await ess.sql("a", "INSERT INTO expense_categories (name) VALUES ('Asesoría QA')");
    const [cat] = await ess.sql("a", "SELECT id FROM expense_categories WHERE name = 'Asesoría QA'");
    await ok(m("saveCategoryAccount", { categoryId: cat.id, accountCode: "623" }));
    await ess.sql("a", `INSERT INTO expenses (date, concept, amount, categoryId, costCenterId, paymentMethod, taxBase, taxRate, taxAmount, deductiblePercent, retentionAmount, supplierName, fiscalReviewStatus)
      VALUES (?, 'Asesoría fiscal', 121.00, ?, 1, 'transfer', 100.00, 21, 21.00, 100, 15.00, 'Gestoría QA', 'revisado')`, [d2(), cat.id]);

    const s = await ok(m("sync", undefined));
    expect(s.errors).toEqual([]);
    expect(s.failedGroups).toEqual([]);
    // factura, cobro, abono, ticket, gasto, pago y cierre
    expect(s.created).toBe(7);

    const o = await ok(q("overview"));
    expect(o.balanced).toBe(true);
    expect(await balance("430")).toBe(12100 - 1210 - 12100); // factura − abono − cobro
    expect(await balance("477")).toBe(-(2100 - 210 + 420));
    expect(await balance("700")).toBe(-(10000 - 1000 + 2000));
    expect(await balance("472")).toBe(2100);
    expect(await balance("623")).toBe(10000);
    expect(await balance("4751")).toBe(-1500);
    expect(await balance("410")).toBe(0); // registrado y pagado
    expect(await balance("572")).toBe(12100 - 10600);
    expect(await balance("570")).toBe(2420 - 50);
    expect(await balance("678")).toBe(50);
    const tb = await ok(q("trialBalance", period()));
    expect(tb.totals.debitCents).toBe(tb.totals.creditCents);
  });

  it("repetir la generación no duplica; dos generaciones a la vez tampoco", async () => {
    const before = (await ok(q("overview"))).counts.entries;
    expect((await ok(m("sync", undefined))).created).toBe(0);
    await ess.sql("a", "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId, paymentMethod, taxRate, taxAmount, fiscalReviewStatus) VALUES (?, 'Material', 60.50, 1, 1, 'cash', 21, 10.50, 'revisado')", [d2()]);
    const [exp] = await ess.sql("a", "SELECT id FROM expenses WHERE concept = 'Material'");
    const [r1, r2] = await Promise.all([m("sync", undefined), m("sync", undefined)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const rowsForDoc = await ess.sql("a", "SELECT COUNT(*) AS n FROM acc_entries WHERE source_key LIKE ?", [`gasto:${exp.id}#%`]);
    expect(Number(rowsForDoc[0].n)).toBe(1);
    expect((await ok(q("overview"))).counts.entries).toBe(before + 2); // gasto + pago
    expect(await balance("570")).toBe(2420 - 50 - 6050);
  });

  it("si el documento cambia, se revierte su asiento y se contabiliza el nuevo; si se anula, se revierte", async () => {
    await ess.sql("a", "UPDATE expenses SET amount = 72.60, taxAmount = 12.60 WHERE concept = 'Material'");
    const s = await ok(m("sync", undefined));
    expect(s.replaced).toBe(2); // gasto y pago
    expect(await balance("472")).toBe(2100 + 1260);
    await ess.sql("a", "UPDATE invoices SET status = 'anulada' WHERE invoiceNumber = 'F-QA-1'");
    const s2 = await ok(m("sync", undefined));
    expect(s2.reversed).toBe(2); // factura y su cobro
    expect(await balance("430")).toBe(-1210); // solo queda el abono
    const j = await ok(q("journal", { ...period(), origin: "reversal" }));
    expect(j.total).toBe(4);
    expect((await ok(q("overview"))).balanced).toBe(true);
  });

  it("asiento manual: cuadre obligatorio, cuentas imputables y activas, revertir; un automático no se revierte a mano", async () => {
    const lines = [
      { accountCode: "57200001", debitCents: 300000, creditCents: 0 },
      { accountCode: "100", debitCents: 0, creditCents: 300000 },
    ];
    expect(errCode(await m("createEntry", { date: `${y()}-01-01`, journal: "APE", description: "Apertura", lines: [lines[0], { ...lines[1], creditCents: 299999 }] }))).toBe("BAD_REQUEST");
    expect(errCode(await m("createEntry", { date: `${y()}-01-01`, journal: "APE", description: "Apertura", lines: [lines[0], { ...lines[1], accountCode: "999" }] }))).toBe("BAD_REQUEST");
    const e = await ok(m("createEntry", { date: `${y()}-01-01`, journal: "APE", description: "Apertura", lines }));
    expect(e.year).toBe(y());
    expect(await balance("57200001")).toBe(300000);
    const led = await ok(q("ledger", { ...period(), account: "572" }));
    // Banco: el pago del gasto (el cobro de la factura se revirtió al anularla) y la apertura de la subcuenta
    expect(led.closingCents).toBe(-10600 + 300000);
    const rev = await ok(m("reverseEntry", { id: e.id, reason: "Error de importe" }));
    expect(rev.number).toBeGreaterThan(e.number);
    expect(errCode(await m("reverseEntry", { id: e.id, reason: "otra vez" }))).toBe("CONFLICT");
    const [auto] = await ess.sql("a", "SELECT id FROM acc_entries WHERE origin = 'expense' LIMIT 1");
    expect(errCode(await m("reverseEntry", { id: auto.id, reason: "no" }))).toBe("CONFLICT");
  });

  it("bloqueo de periodo: un manual no entra; un documento con fecha bloqueada va al primer día abierto, una vez y sin bucles; la fecha de inicio no cambia", async () => {
    const st = await ok(q("settings"));
    expect(st.startDateEditable).toBe(false);
    expect(errCode(await m("saveSettings", { startDate: `${y()}-02-01`, lockedUntil: null, map: st.map }))).toBe("CONFLICT");
    await ok(m("saveSettings", { startDate: st.startDate, lockedUntil: `${y()}-01-31`, map: st.map }));
    const r = await m("createEntry", { date: `${y()}-01-10`, journal: "GEN", description: "Tarde", lines: [{ accountCode: "629", debitCents: 100, creditCents: 0 }, { accountCode: "570", debitCents: 0, creditCents: 100 }] });
    expect(errCode(r)).toBe("CONFLICT");
    // Un gasto nuevo con fecha en el periodo bloqueado: se contabiliza el primer día abierto (hoy), una sola vez
    expect(today() > `${y()}-01-31`).toBe(true); // (la prueba usa enero: no se ejecuta en enero)
    await ess.sql("a", "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId, paymentMethod, taxRate, taxAmount, fiscalReviewStatus) VALUES (?, 'Tardío', 12.10, 1, 1, 'cash', 21, 2.10, 'revisado')", [`${y()}-01-25`]);
    const [late] = await ess.sql("a", "SELECT id FROM expenses WHERE concept = 'Tardío'");
    const s = await ok(m("sync", undefined));
    expect(s).toMatchObject({ created: 2, deferred: 2, blocked: 0 });
    const [e] = await ess.sql("a", "SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS d, description FROM acc_entries WHERE source_key LIKE ?", [`gasto:${late.id}#%`]);
    expect(e.d).toBe(today());
    expect(e.description).toContain("periodo bloqueado");
    // Repetir no lo vuelve a pedir: ni «bloqueado» en cada generación ni duplicado
    expect(await ok(m("sync", undefined))).toMatchObject({ created: 0, replaced: 0, reversed: 0, deferred: 0, blocked: 0 });
    // Si cambia el documento del periodo bloqueado, se corrige hoy, una vez
    await ess.sql("a", "UPDATE expenses SET amount = 24.20, taxAmount = 4.20 WHERE id = ?", [late.id]);
    expect(await ok(m("sync", undefined))).toMatchObject({ replaced: 2, deferred: 2, blocked: 0 });
    expect(await ok(m("sync", undefined))).toMatchObject({ created: 0, replaced: 0, reversed: 0, blocked: 0 });
    // Al desbloquear no se vuelve a contabilizar nada
    await ok(m("saveSettings", { startDate: st.startDate, lockedUntil: null, map: st.map }));
    expect(await ok(m("sync", undefined))).toMatchObject({ created: 0, replaced: 0, reversed: 0 });
    expect((await ok(q("overview"))).balanced).toBe(true);
  });

  it("retirada de caja del TPV de tipo gasto: la caja baja una sola vez, el puente queda saldado y sin IVA inventado", async () => {
    const [b570, b555, b472] = [await balance("570"), await balance("555"), await balance("472")];
    // Lo que deja tpv.addCashMovement (outKind gasto): el movimiento de caja y un gasto en efectivo con source tpv
    const [ses] = await ess.sql("a", "SELECT id FROM cash_sessions ORDER BY id DESC LIMIT 1");
    await ess.sql("a", "INSERT INTO cash_movements (sessionId, type_cm, amount, reason, cashierName, createdAt) VALUES (?, 'out', 30.00, 'Compra de hielo', 'Cajero', ?)", [ses.id, noon(d2()).getTime()]);
    await ess.sql("a", "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId, paymentMethod, status, source) VALUES (?, 'Retirada de caja TPV — Compra de hielo', 30.00, 1, 1, 'cash', 'conciliado', 'tpv')", [d2()]);
    const s = await ok(m("sync", undefined));
    expect(s.errors).toEqual([]);
    expect(s.created).toBe(3); // movimiento de caja, gasto y su pago
    expect((await balance("570")) - b570).toBe(-3000);
    expect((await balance("555")) - b555).toBe(0);
    expect((await balance("472")) - b472).toBe(0);
    expect((await ok(q("overview"))).balanced).toBe(true);
  });

  it("IVA solo de datos reales: un gasto sin desglose revisado se contabiliza sin IVA y queda para revisar; al revisarlo, se corrige", async () => {
    const [b472, b623] = [await balance("472"), await balance("623")];
    // Como los crea la conciliación bancaria o el formulario público: taxRate 21 por defecto, sin cuota, pendiente
    await ess.sql("a", "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId, paymentMethod) SELECT ?, 'Sin desglose QA', 121.00, id, 1, 'transfer' FROM expense_categories WHERE name = 'Asesoría QA'", [d2()]); // categoría con cuenta 623
    const [exp] = await ess.sql("a", "SELECT id FROM expenses WHERE concept = 'Sin desglose QA'");
    const s = await ok(m("sync", undefined));
    expect(s.errors).toEqual([]);
    expect(s.review.map((r: any) => r.key)).toContain(`gasto:${exp.id}`);
    expect((await balance("472")) - b472).toBe(0);
    expect((await balance("623")) - b623).toBe(12100);
    // Revisado en el formulario de gastos (10 %): el documento cambió y su asiento se sustituye con el IVA real
    await ess.sql("a", "UPDATE expenses SET taxRate = 10, taxBase = 110.00, taxAmount = 11.00, fiscalReviewStatus = 'revisado' WHERE id = ?", [exp.id]);
    const s2 = await ok(m("sync", undefined));
    expect(s2.replaced).toBe(1);
    expect(s2.review.map((r: any) => r.key)).not.toContain(`gasto:${exp.id}`);
    expect((await balance("472")) - b472).toBe(1100);
    expect((await balance("623")) - b623).toBe(11000);
  });

  it("ticket cobrado en efectivo y devuelto con salida manual de caja: la caja entra y sale una sola vez", async () => {
    const [b570, b555, b700] = [await balance("570"), await balance("555"), await balance("700")];
    const at = noon(d2());
    const [ses] = await ess.sql("a", "SELECT id FROM cash_sessions ORDER BY id DESC LIMIT 1");
    await ess.sql("a", "INSERT INTO tpv_sales (ticketNumber, sessionId, subtotal, total, status_ts, createdAt, paidAt) VALUES ('T-QA-DEV', ?, 12.10, 12.10, 'paid', ?, ?)", [ses.id, at.getTime(), at.getTime()]);
    const [sale] = await ess.sql("a", "SELECT id FROM tpv_sales WHERE ticketNumber = 'T-QA-DEV'");
    await ess.sql("a", "INSERT INTO tpv_sale_items (saleId, productType_tsi, productId, productName, unitPrice, subtotal_tsi, fiscalRegime_tsi, taxRate_tsi) VALUES (?, 'experience', 1, 'Actividad', 12.10, 12.10, 'general', 21)", [sale.id]);
    await ess.sql("a", "INSERT INTO tpv_sale_payments (saleId, method_tsp, amount_tsp, status_tsp, createdAt) VALUES (?, 'cash', 12.10, 'completed', ?)", [sale.id, at.getTime()]);
    expect((await ok(m("sync", undefined))).created).toBe(1);
    expect((await balance("570")) - b570).toBe(1210);
    // Se devuelve: la venta pasa a refunded y el efectivo sale con su movimiento manual (como lo pide el cierre de caja)
    await ess.sql("a", "UPDATE tpv_sales SET status_ts = 'refunded' WHERE id = ?", [sale.id]);
    await ess.sql("a", "INSERT INTO cash_movements (sessionId, type_cm, amount, reason, cashierName, createdAt) VALUES (?, 'out', 12.10, 'Devolución T-QA-DEV', 'Cajero', ?)", [ses.id, at.getTime()]);
    const s = await ok(m("sync", undefined));
    expect(s.errors).toEqual([]);
    expect((await balance("570")) - b570).toBe(0);
    expect((await balance("555")) - b555).toBe(0);
    expect((await balance("700")) - b700).toBe(0);
    expect((await ok(q("overview"))).balanced).toBe(true);
  });

  it("documentos anteriores al inicio cobrados o pagados después: solo el cobro o el pago, en su fecha, contra la apertura", async () => {
    const [b430, b410, b572, b700] = [await balance("430"), await balance("410"), await balance("572"), await balance("700")];
    const prev = `${y() - 1}-12-20`;
    await ess.sql("a", `INSERT INTO invoices (invoiceNumber, clientName, clientEmail, subtotal, taxRate, taxAmount, taxBreakdown, total, status, invoiceType, paymentMethod, issuedAt, paymentValidatedAt)
      VALUES ('F-QA-ANT', 'Cliente QA', 'qa@example.com', 41.32, 21, 8.68, '[{"rate":21,"base":41.32,"amount":8.68}]', 50.00, 'cobrada', 'factura', 'transferencia', ?, ?)`, [noon(prev), noon(d2())]);
    // Otra anterior y cobrada antes del inicio: nada (va en la apertura)
    await ess.sql("a", `INSERT INTO invoices (invoiceNumber, clientName, clientEmail, subtotal, taxRate, taxAmount, taxBreakdown, total, status, invoiceType, paymentMethod, issuedAt, paymentValidatedAt)
      VALUES ('F-QA-ANT2', 'Cliente QA', 'qa@example.com', 10.00, 21, 2.10, '[{"rate":21,"base":10,"amount":2.1}]', 12.10, 'cobrada', 'factura', 'transferencia', ?, ?)`, [noon(prev), noon(prev)]);
    await ess.sql("a", "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId, paymentMethod, taxRate, taxBase, taxAmount, fiscalReviewStatus) VALUES (?, 'Gasto anterior QA', 30.00, 1, 1, 'transfer', 21, 24.79, 5.21, 'revisado')", [prev]);
    const [exp] = await ess.sql("a", "SELECT id FROM expenses WHERE concept = 'Gasto anterior QA'");
    await ess.sql("a", "INSERT INTO bank_movements (import_id, fecha, importe, duplicate_key, conciliation_status) VALUES (1, ?, -30.00, 'qa-ant', 'conciliado')", [d2()]);
    const [mov] = await ess.sql("a", "SELECT id FROM bank_movements WHERE duplicate_key = 'qa-ant'");
    await ess.sql("a", "INSERT INTO bank_movement_links (bank_movement_id, entity_type, entity_id, link_type, amount_linked, status) VALUES (?, 'expense', ?, 'expense_payment', 30.00, 'confirmed')", [mov.id, exp.id]);
    const s = await ok(m("sync", undefined));
    expect(s.errors).toEqual([]);
    expect(s.created).toBe(2); // el cobro y el pago; ni la factura ni el gasto
    expect((await balance("430")) - b430).toBe(-5000);
    expect((await balance("410")) - b410).toBe(3000);
    expect((await balance("572")) - b572).toBe(5000 - 3000);
    expect((await balance("700")) - b700).toBe(0);
    const [e] = await ess.sql("a", "SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS d FROM acc_entries WHERE source_key LIKE ?", [`pago:${exp.id}#%`]);
    expect(e.d).toBe(d2());
    expect((await ok(q("overview"))).balanced).toBe(true);
  });

  it("libros y exportaciones para la gestoría: diario, mayor, sumas y saldos, pérdidas y ganancias y Excel", async () => {
    const j = await ok(q("export", { ...period(), kind: "journal" }));
    const csv = Buffer.from(j.base64, "base64").toString("utf8");
    expect(csv.startsWith("﻿Ejercicio;Asiento;Fecha;Diario")).toBe(true);
    expect(csv).toContain("A-QA-1");
    const l = await ok(q("export", { ...period(), kind: "ledger", account: "430" }));
    expect(l.fileName).toMatch(/^mayor_430_/);
    const pnl = await ok(q("profitAndLoss", period()));
    expect(pnl.items.find((i: any) => i.key === "p1").cents).toBe(-(await balance("700")));
    const x = await ok(q("export", { ...period(), kind: "workbook" }));
    const wb = XLSX.read(Buffer.from(x.base64, "base64"), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Diario", "Sumas y saldos", "Pérdidas y ganancias"]);
  });

  it("cambiar las cuentas de Ajustes o la de una categoría no revierte ni vuelve a contabilizar el histórico", async () => {
    const st = await ok(q("settings"));
    const before = (await ok(q("overview"))).counts.entries;
    const [b623, b572] = [await balance("623"), await balance("572")];
    await ok(m("saveSettings", { startDate: st.startDate, lockedUntil: null, map: { ...st.map, bank: "57200001", card: "57200001", sales: "705", suppliers: "400" } }));
    const [cat] = await ess.sql("a", "SELECT id FROM expense_categories WHERE name = 'Asesoría QA'");
    await ok(m("saveCategoryAccount", { categoryId: cat.id, accountCode: "629" }));
    expect(await ok(m("sync", undefined))).toMatchObject({ created: 0, replaced: 0, reversed: 0, blocked: 0 });
    expect((await ok(q("overview"))).counts.entries).toBe(before);
    expect(await balance("623")).toBe(b623); // lo contabilizado conserva su cuenta
    expect(await balance("572")).toBe(b572);
    // Lo nuevo sí va con las cuentas nuevas
    const b629 = await balance("629");
    await ess.sql("a", "INSERT INTO expenses (date, concept, amount, categoryId, costCenterId, paymentMethod, taxRate, taxBase, taxAmount, fiscalReviewStatus) VALUES (?, 'Asesoría nueva', 60.50, ?, 1, 'transfer', 21, 50.00, 10.50, 'revisado')", [d2(), cat.id]);
    expect((await ok(m("sync", undefined))).created).toBe(2);
    expect((await balance("629")) - b629).toBe(5000);
    expect(await balance("400")).toBe(0); // registrado y pagado contra la cuenta nueva de proveedores
    expect((await ok(q("overview"))).balanced).toBe(true);
  });

  it("aislamiento: la otra empresa no ve nada y sus asientos son solo suyos", async () => {
    const o = await ok(q("overview", undefined, adB, "b"));
    expect(o.counts.entries).toBe(0);
    expect((await ok(m("sync", undefined, adB, "b"))).created).toBe(0);
    const j = await ok(q("journal", period(), adB, "b"));
    expect(j.total).toBe(0);
    const [sub] = await ess.sql("b", "SELECT COUNT(*) AS n FROM acc_accounts WHERE code = '57200001'");
    expect(Number(sub.n)).toBe(0);
  });

  it("en solo lectura: se consultan los libros, pero no se genera ni se contabiliza nada", async () => {
    await ess.setCapability("a", CAP, "read_only");
    expect((await q("journal", period())).status).toBe(200);
    expect((await q("export", { ...period(), kind: "trial" })).status).toBe(200);
    expect(isLicenseDenied(await m("sync", undefined), CAP)).toBe(true);
    expect(isLicenseDenied(await m("createEntry", { date: today(), journal: "GEN", description: "x", lines: [] }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
  });
});
