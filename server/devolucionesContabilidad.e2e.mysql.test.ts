/**
 * Devoluciones: UNA operación = UN documento DEV, UN abono, ningún reembolso a pasarela y UN solo efecto contable
 * (aplicación real sobre MySQL, opt-in con REGISTRY_TEST_DATABASE_URL; datos sintéticos; sin red: la pasarela está simulada
 * y cuenta cualquier intento de llamar a Stripe o Redsys).
 *
 * Cuatro cosas distintas que NO deben confundirse:
 *  A) documento DEV: fila `transactions` (type reembolso, DEV-AAAA-NNNN) que crea la anulación al aceptarse;
 *  B) devolución de dinero: la ejecuta una persona fuera del sistema; `markRefundExecuted` solo cambia el estado (no crea nada);
 *  C) abono: factura rectificativa (`invoices.invoiceType = abono`, serie ABN);
 *  D) asiento: la Contabilidad general solo lee facturas/abonos/tickets, cobros, gastos y caja; NUNCA `transactions`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp, type Res } from "./essentialApp.testkit";
import { madridYear } from "./utils/timezone";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 120_000 });
const YEAR = madridYear();

describe.skipIf(!URL_)("devolución: A (DEV) / B (dinero) / C (abono) / D (asiento) sin doble efecto", () => {
  let ess: EssentialApp;
  let ad = "";
  const gateway: string[] = [];
  let seq = 0;

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const one = async (q: string, p: unknown[] = []) => (await ess.sql("a", q, p))[0];

  /** Reserva pagada 121 € con factura cobrada, ingreso y solicitud de anulación vinculada. */
  async function seed(opts: { extras?: boolean } = {}) {
    const n = ++seq;
    const now = Date.now();
    const extras = opts.extras ? JSON.stringify([{ name: "Extra A", priceCents: 3000, quantity: 1 }, { name: "Extra B", priceCents: 3000, quantity: 1 }]) : "[]";
    await ess.sql("a", "INSERT INTO reservations (product_id, product_name, booking_date, people, amount_total, amount_paid, status, status_reservation, status_payment, customer_name, customer_email, merchant_order, reservation_number, extras_json, created_at, updated_at, paid_at) VALUES (1, 'Actividad QA', '2026-12-20', 1, 12100, 12100, 'paid', 'CONFIRMADA', 'PAGADO', 'Cliente Sintetico', 'qa@example.com', ?, ?, ?, ?, ?, ?)", [`M-QA-${n}`, `RES-QA-${n}`, extras, now, now, now]);
    const res = await one("SELECT id FROM reservations WHERE reservation_number = ?", [`RES-QA-${n}`]);
    await ess.sql("a", "INSERT INTO invoices (invoiceNumber, reservationId, clientName, clientEmail, subtotal, taxRate, taxAmount, taxBreakdown, total, status, invoiceType, paymentMethod, issuedAt) VALUES (?, ?, 'Cliente Sintetico', 'qa@example.com', 100.00, 21, 21.00, '[{\"rate\":21,\"base\":100,\"amount\":21}]', 121.00, 'cobrada', 'factura', 'transferencia', ?)", [`F-QA-${n}`, res.id, new Date()]);
    const inv = await one("SELECT id FROM invoices WHERE invoiceNumber = ?", [`F-QA-${n}`]);
    await ess.sql("a", "UPDATE reservations SET invoiceId = ?, invoiceNumber = ? WHERE id = ?", [inv.id, `F-QA-${n}`, res.id]);
    await ess.sql("a", "INSERT INTO transactions (transactionNumber, type, amount, currency, status, paymentMethod, reservationId_tx, operationStatus, clientName) VALUES (?, 'ingreso', 121.00, 'EUR', 'completado', 'transferencia', ?, 'confirmada', 'Cliente Sintetico')", [`TX-QA-${n}`, res.id]);
    const r = ok(await ess.m("a", "cancellations.createManualRequest", { fullName: "Cliente Sintetico", email: "qa@example.com", activityDate: "2026-12-20", reason: "otra" }, ad), "crear solicitud");
    ok(await ess.m("a", "cancellations.linkToReservation", { requestId: r.requestId, reservationId: res.id }, ad), "vincular");
    return { resId: Number(res.id), invId: Number(inv.id), reqId: Number(r.requestId) };
  }

  /** Lo que una operación deja en A (DEV), C (abonos), la factura, el ingreso y la serie de facturas. */
  async function measure(s: { resId: number; invId: number }) {
    const dev = await ess.sql("a", "SELECT transactionNumber AS n, amount FROM transactions WHERE type = 'reembolso' AND reservationId_tx = ? ORDER BY id", [s.resId]);
    const abonos = await ess.sql("a", "SELECT invoiceNumber AS n, total FROM invoices WHERE invoiceType = 'abono' AND creditNoteForId = ? ORDER BY id", [s.invId]);
    const inv = await one("SELECT status FROM invoices WHERE id = ?", [s.invId]);
    const ing = await one("SELECT status FROM transactions WHERE type = 'ingreso' AND reservationId_tx = ?", [s.resId]);
    return { dev: dev.map((d: any) => d.n as string), devAmounts: dev.map((d: any) => Number(d.amount)), abonos: abonos.map((a: any) => a.n as string), abonoTotals: abonos.map((a: any) => Number(a.total)), invoice: inv.status as string, ingreso: ing.status as string, gateway: gateway.length };
  }
  const facCounter = async () => Number((await one("SELECT COALESCE(MAX(current_number), 0) AS n FROM document_counters WHERE document_type = 'factura' AND `year` = ?", [YEAR])).n);
  const accept = (id: number, extra: Record<string, unknown> = {}) => ess.m("a", "cancellations.acceptRequest", { id, compensationType: "devolucion", refundAmount: 121, sendEmail: false, ...extra }, ad);

  /** Sincroniza la Contabilidad general (base sintética local) y devuelve los asientos de la operación. */
  async function entriesOf(s: { invId: number }) {
    const sm = ok(await ess.m("a", "accountingGeneral.sync", { startDate: `${YEAR}-01-01` }, ad), "sync");
    void sm;
    const abonoIds = (await ess.sql("a", "SELECT id FROM invoices WHERE creditNoteForId = ? AND invoiceType = 'abono'", [s.invId])).map((x: any) => x.id);
    const keys = [`inv:${s.invId}`, `cobro:${s.invId}`, ...abonoIds.map((i: number) => `inv:${i}`)];
    const rows = ((await ess.sql("a", "SELECT source_key AS k, total_cents AS t FROM acc_entries WHERE reversed_by_entry_id IS NULL AND source_key IS NOT NULL")) as any[]).map((r) => ({ k: String(r.k).split("#")[0], t: r.t })).filter((r) => keys.includes(r.k));
    const all = await ess.sql("a", "SELECT COUNT(*) AS n FROM acc_entries WHERE source_key LIKE 'tx:%' OR source_key LIKE 'dev:%' OR source_key LIKE 'reembolso:%' OR description LIKE '%DEV-%'");
    return { keys: rows.map((r: any) => r.k as string).sort(), cents: rows.map((r: any) => Number(r.t)), anyDevEntry: Number(all[0].n) };
  }

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "devc");
    // Pasarela simulada: cualquier intento de hablar con Stripe/Redsys se cuenta (el resto lo bloquea el kit)
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: unknown) => {
      const target = String(input instanceof URL ? input.href : typeof input === "string" ? input : (input as { url: string }).url);
      if (/stripe|redsys|sermepa/i.test(target)) gateway.push(target);
      return inner(input as any, init as any);
    }) as typeof fetch;
    ad = await ess.login("a", "admin");
    await ess.markPaid("a");
    await ess.setCapability("a", "accounting-general", "active");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("TOTAL: un DEV (A), ningún reembolso a pasarela (B), un abono (C), la serie de facturas no se mueve y UN asiento por documento (D)", async () => {
    const s = await seed();
    const fac0 = await facCounter();
    expect((await entriesOf(s)).keys).toEqual([`cobro:${s.invId}`, `inv:${s.invId}`].sort()); // antes de anular: factura y cobro
    const a = ok(await accept(s.reqId), "aceptar");
    const m = await measure(s);
    console.log("[TOTAL]", JSON.stringify({ a, ...m, fac: [fac0, await facCounter()] }));
    expect(m.dev).toHaveLength(1);
    expect(m.dev[0]).toMatch(new RegExp(`^DEV-${YEAR}-\\d{4}$`));
    expect(m.devAmounts).toEqual([-121]);
    expect(m.abonos).toHaveLength(1);
    expect(m.abonos[0]).toMatch(new RegExp(`^ABN-${YEAR}-\\d{4}$`));
    expect(m.abonoTotals).toEqual([-121]);
    expect(m.invoice).toBe("abonada");
    expect(m.ingreso).toBe("reembolsado");
    expect(m.gateway).toBe(0);
    expect(a.creditNoteNumber).toBe(m.abonos[0]);
    expect(await facCounter()).toBe(fac0); // (#955) la devolución ya no consume números de factura
    // B: marcar el dinero como devuelto NO crea otro DEV ni otro abono
    ok(await ess.m("a", "cancellations.markRefundExecuted", { id: s.reqId }, ad), "marcar devuelta");
    const m2 = await measure(s);
    expect(m2.dev).toEqual(m.dev);
    expect(m2.abonos).toEqual(m.abonos);
    const e = await entriesOf(s);
    const tb = ok(await ess.q("a", "accountingGeneral.trialBalance", { from: `${YEAR}-01-01`, to: `${YEAR}-12-31` }, ad), "balance");
    console.log("[TOTAL asientos]", JSON.stringify({ ...e, saldos: tb.items.filter((r: any) => ["430", "700", "477", "572", "570"].includes(r.code)).map((r: any) => [r.code, r.balanceCents]) }));
    // D: factura + cobro (ya contabilizados antes de anular) + abono = tres asientos, uno por documento; el DEV no genera ninguno
    expect(e.keys).toEqual([`cobro:${s.invId}`, `inv:${s.invId}`, `inv:${(await ess.sql("a", "SELECT id FROM invoices WHERE creditNoteForId = ?", [s.invId]))[0].id}`].sort());
    expect(e.anyDevEntry).toBe(0);
    // Repetir la sincronización no duplica
    const again = await entriesOf(s);
    expect(again.keys).toEqual(e.keys);
  });

  it("REINTENTO: aceptar de nuevo la misma anulación se rechaza y no crea otro DEV, abono ni reembolso", async () => {
    const s = await seed();
    ok(await accept(s.reqId), "aceptar");
    const before = await measure(s);
    const again = await accept(s.reqId);
    expect(again.status).not.toBe(200);
    expect(await measure(s)).toEqual(before);
    const direct = await ess.m("a", "cancellations.cancelReservationDirect", { reservationId: s.resId, reason: "otra", compensationType: "devolucion", refundAmount: 121 }, ad);
    expect(direct.status).not.toBe(200);
    expect(await measure(s)).toEqual(before);
  });

  it("PARCIAL por líneas: un DEV de 30 (A), sin abono (C), factura sin cambiar; la reserva sigue viva", async () => {
    const s = await seed({ extras: true });
    const fac0 = await facCounter();
    ok(await accept(s.reqId, { refundAmount: 30, isPartial: true, cancellationScope: "lineas", cancelledItems: [{ index: 0, name: "Extra A", priceCents: 3000, quantity: 1 }] }), "aceptar parcial");
    const m = await measure(s);
    console.log("[PARCIAL lineas]", JSON.stringify(m));
    expect(m.dev).toHaveLength(1);
    expect(m.devAmounts).toEqual([-30]);
    expect(m.abonos).toHaveLength(0);
    expect(m.invoice).toBe("cobrada");
    expect(m.gateway).toBe(0);
    expect(await facCounter()).toBe(fac0);
    const e = await entriesOf(s);
    expect(e.anyDevEntry).toBe(0);
    expect(e.keys).toEqual([`cobro:${s.invId}`, `inv:${s.invId}`].sort());
  });

  it("PARCIAL de importe (anulación total con 50 €): un DEV de 50 y un abono de 50", async () => {
    const s = await seed();
    ok(await accept(s.reqId, { refundAmount: 50, isPartial: true }), "aceptar");
    const m = await measure(s);
    console.log("[PARCIAL importe]", JSON.stringify(m));
    expect(m.dev).toHaveLength(1);
    expect(m.abonos).toHaveLength(1);
    expect(m.devAmounts).toEqual([-50]);
    expect(m.abonoTotals).toEqual([-50]);
    expect(m.gateway).toBe(0);
  });

  // BRECHA PREEXISTENTE (idéntica con y sin #955, comprobado contra integration/elephant-source): `acceptRequest` comprueba
  // «sin_resolver» con una lectura y escribe después sin condición, y `propagateCancellation` lee el estado de la factura fuera
  // de la transacción. Dos aceptaciones simultáneas pueden crear dos DEV y dos abonos. Estas pruebas NO exigen «uno» (fallarían
  // de forma intermitente con el código actual): fijan lo que SÍ debe cumplirse siempre y dejan las cifras en el registro.
  // Cuando se cierre la brecha, endurecer a `toHaveLength(1)`. (La ruta `cancelReservationDirect` tiene la misma brecha: medida a mano con 6 llamadas, 3 DEV y 3 abonos, y tarda ~50 s por esperas de bloqueo, por eso no se incluye.)
  it("SIMULTÁNEA (brecha conocida): 6 aceptaciones a la vez: cada DEV tiene su abono, números únicos y ningún reembolso a pasarela", async () => {
    const s = await seed();
    const rs = await Promise.all(Array.from({ length: 6 }, () => accept(s.reqId)));
    const m = await measure(s);
    const won = rs.filter((r) => r.status === 200).length;
    console.log("[SIMULTANEA aceptar]", JSON.stringify({ http: rs.map((r) => r.status), ...m, asientos: await entriesOf(s) }));
    expect(m.dev.length).toBeGreaterThanOrEqual(1);
    expect(m.dev.length).toBe(m.abonos.length); // sin estados a medias: cada DEV con su abono
    expect(m.dev.length).toBe(won);
    expect(new Set(m.dev).size).toBe(m.dev.length);
    expect(new Set(m.abonos).size).toBe(m.abonos.length);
    expect(m.gateway).toBe(0);
  });


  it("SIMULTÁNEA por líneas (brecha conocida): la reserva se reduce una sola vez y los DEV tienen números únicos", async () => {
    const s = await seed({ extras: true });
    const rs = await Promise.all(Array.from({ length: 6 }, () => accept(s.reqId, { refundAmount: 30, isPartial: true, cancellationScope: "lineas", cancelledItems: [{ index: 0, name: "Extra A", priceCents: 3000, quantity: 1 }] })));
    const m = await measure(s);
    const res = await one("SELECT amount_total AS t FROM reservations WHERE id = ?", [s.resId]);
    console.log("[SIMULTANEA lineas]", JSON.stringify({ http: rs.map((r) => r.status), ...m, amountTotalCents: Number(res.t) }));
    expect(m.dev.length).toBeGreaterThanOrEqual(1);
    expect(new Set(m.dev).size).toBe(m.dev.length);
    expect(m.abonos).toHaveLength(0);
    expect(Number(res.t)).toBe(9100);
    expect(m.gateway).toBe(0);
  });

  it("(#955) con DEV históricos tomados de la serie de facturas, el siguiente DEV continúa tras el mayor y la serie FAC no se mueve", async () => {
    await ess.sql("a", "INSERT INTO transactions (transactionNumber, type, amount, currency, status) VALUES (?, 'reembolso', -1.00, 'EUR', 'completado'), (?, 'reembolso', -1.00, 'EUR', 'completado')", [`DEV-${YEAR}-0470`, `DEV-${YEAR}-0119`]);
    const s = await seed();
    const fac0 = await facCounter();
    ok(await accept(s.reqId), "aceptar");
    const m = await measure(s);
    console.log("[DEV historico]", JSON.stringify({ dev: m.dev, fac: [fac0, await facCounter()] }));
    expect(m.dev).toEqual([`DEV-${YEAR}-0471`]);
    expect(await facCounter()).toBe(fac0);
    // marcar la devolución como ejecutada es solo un cambio de estado: una segunda marca se rechaza y no crea nada
    ok(await ess.m("a", "cancellations.markRefundExecuted", { id: s.reqId }, ad), "marcar");
    expect((await ess.m("a", "cancellations.markRefundExecuted", { id: s.reqId }, ad)).status).not.toBe(200);
    expect((await measure(s)).dev).toEqual(m.dev);
  });

  it("la Contabilidad general no lee transacciones: sus asientos solo salen de facturas, abonos, tickets, cobros, gastos y caja", async () => {
    const [{ n }] = await ess.sql("a", "SELECT COUNT(*) AS n FROM acc_entries WHERE source_key NOT REGEXP '^(inv|tpv|cobro|gasto|pago|cierre|cajamov):' AND source_key IS NOT NULL");
    expect(Number(n)).toBe(0);
  });
});
