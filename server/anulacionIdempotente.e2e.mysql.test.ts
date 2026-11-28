/**
 * P0 fiscal: una anulación = UNA consecuencia fiscal (un DEV, un abono, un efecto contable), también con llamadas simultáneas.
 * Aplicación real sobre MySQL (opt-in con REGISTRY_TEST_DATABASE_URL; datos SINTÉTICOS; sin red: la pasarela está simulada y
 * cuenta cualquier intento de hablar con Stripe o Redsys, que debe ser 0). Ejecutar en serie (--no-file-parallelism).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33971/registro_test \
 *     pnpm vitest run --no-file-parallelism server/anulacionIdempotente.e2e.mysql.test.ts
 *
 * La numeración del DEV (serie de facturas o serie propia de #955) no se afirma aquí: se mide el NÚMERO de documentos, no su serie.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, type EssentialApp, type Res } from "./essentialApp.testkit";
import { madridYear } from "./utils/timezone";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 300_000 });
const YEAR = madridYear();
const SIZES = [6, 12, 24];

describe.skipIf(!URL_)("anulación idempotente: un DEV, un abono, un efecto contable", () => {
  let ess: EssentialApp;
  let ad = "";
  let adB = "";
  const gateway: string[] = [];
  let seq = 0;

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const one = async (q: string, p: unknown[] = [], co: "a" | "b" = "a") => (await ess.sql(co, q, p))[0];

  type Seed = { resId: number; invId: number | null; reqId: number | null };
  /** Reserva pagada 121 € (con o sin factura) y, opcionalmente, solicitud de anulación vinculada. */
  async function seed(opts: { extras?: boolean; invoice?: boolean; request?: boolean; fullName?: string; co?: "a" | "b" } = {}): Promise<Seed> {
    const co = opts.co ?? "a";
    const tok = co === "a" ? ad : adB;
    const n = ++seq;
    const now = Date.now();
    const extras = opts.extras ? JSON.stringify([{ name: "Extra A", priceCents: 3000, quantity: 1 }, { name: "Extra B", priceCents: 3000, quantity: 1 }]) : "[]";
    const name = opts.fullName ?? "Cliente Sintetico";
    await ess.sql(co, "INSERT INTO reservations (product_id, product_name, booking_date, people, amount_total, amount_paid, status, status_reservation, status_payment, customer_name, customer_email, merchant_order, reservation_number, extras_json, created_at, updated_at, paid_at) VALUES (1, 'Actividad QA', '2026-12-20', 1, 12100, 12100, 'paid', 'CONFIRMADA', 'PAGADO', ?, 'qa@example.com', ?, ?, ?, ?, ?, ?)", [name, `M-${co}-${n}`, `RES-${co}-${n}`, extras, now, now, now]);
    const res = await one("SELECT id FROM reservations WHERE reservation_number = ?", [`RES-${co}-${n}`], co);
    let invId: number | null = null;
    if (opts.invoice !== false) {
      await ess.sql(co, "INSERT INTO invoices (invoiceNumber, reservationId, clientName, clientEmail, subtotal, taxRate, taxAmount, taxBreakdown, total, status, invoiceType, paymentMethod, issuedAt) VALUES (?, ?, ?, 'qa@example.com', 100.00, 21, 21.00, '[{\"rate\":21,\"base\":100,\"amount\":21}]', 121.00, 'cobrada', 'factura', 'transferencia', ?)", [`F-${co}-${n}`, res.id, name, new Date()]);
      const inv = await one("SELECT id FROM invoices WHERE invoiceNumber = ?", [`F-${co}-${n}`], co);
      invId = Number(inv.id);
      await ess.sql(co, "UPDATE reservations SET invoiceId = ?, invoiceNumber = ? WHERE id = ?", [inv.id, `F-${co}-${n}`, res.id]);
    }
    await ess.sql(co, "INSERT INTO transactions (transactionNumber, type, amount, currency, status, paymentMethod, reservationId_tx, operationStatus, clientName) VALUES (?, 'ingreso', 121.00, 'EUR', 'completado', 'transferencia', ?, 'confirmada', ?)", [`TX-${co}-${n}`, res.id, name]);
    let reqId: number | null = null;
    if (opts.request !== false) {
      const r = ok(await ess.m(co, "cancellations.createManualRequest", { fullName: name, email: "qa@example.com", activityDate: "2026-12-20", reason: "otra" }, tok), "crear solicitud");
      ok(await ess.m(co, "cancellations.linkToReservation", { requestId: r.requestId, reservationId: res.id }, tok), "vincular");
      reqId = Number(r.requestId);
    }
    return { resId: Number(res.id), invId, reqId };
  }

  async function measure(s: Seed, co: "a" | "b" = "a") {
    const dev = await ess.sql(co, "SELECT transactionNumber AS n, amount FROM transactions WHERE type = 'reembolso' AND reservationId_tx = ? ORDER BY id", [s.resId]);
    const abonos = s.invId
      ? await ess.sql(co, "SELECT id, invoiceNumber AS n, total FROM invoices WHERE invoiceType = 'abono' AND creditNoteForId = ? ORDER BY id", [s.invId])
      : [];
    const reqs = await ess.sql(co, "SELECT id, cancellation_number AS num FROM cancellation_requests WHERE linked_reservation_id = ? ORDER BY id", [s.resId]);
    const res = await one("SELECT status, amount_total AS t FROM reservations WHERE id = ?", [s.resId], co);
    const inv = s.invId ? (await one("SELECT status FROM invoices WHERE id = ?", [s.invId], co)).status : null;
    return {
      dev: dev.map((d: any) => d.n as string),
      devAmounts: dev.map((d: any) => Number(d.amount)),
      abonos: abonos.map((a: any) => a.n as string),
      abonoIds: abonos.map((a: any) => Number(a.id)),
      abonoTotals: abonos.map((a: any) => Number(a.total)),
      requests: reqs.length,
      anuNumbers: reqs.map((r: any) => r.num as string | null).filter(Boolean),
      reservation: res.status as string,
      amountTotalCents: Number(res.t),
      invoice: inv as string | null,
      gateway: gateway.length,
    };
  }
  const counter = async (type: string, co: "a" | "b" = "a") =>
    Number((await one("SELECT COALESCE(MAX(current_number), 0) AS n FROM document_counters WHERE document_type = ? AND `year` = ?", [type, YEAR], co)).n);
  const counters = async (co: "a" | "b" = "a") => ({ anulacion: await counter("anulacion", co), abono: await counter("abono", co), factura: await counter("factura", co) });

  const accept = (id: number, extra: Record<string, unknown> = {}, tok = ad, co: "a" | "b" = "a") =>
    ess.m(co, "cancellations.acceptRequest", { id, compensationType: "devolucion", refundAmount: 121, sendEmail: false, ...extra }, tok);
  const direct = (resId: number, extra: Record<string, unknown> = {}) =>
    ess.m("a", "cancellations.cancelReservationDirect", { reservationId: resId, reason: "otra", compensationType: "devolucion", refundAmount: 121, ...extra }, ad);
  const LINE = { refundAmount: 30, isPartial: true, cancellationScope: "lineas", cancelledItems: [{ index: 0, name: "Extra A", priceCents: 3000, quantity: 1 }] };

  /** Sincroniza Contabilidad general (base sintética local) dos veces y devuelve los asientos de la operación. */
  async function entriesOf(s: Seed) {
    ok(await ess.m("a", "accountingGeneral.sync", { startDate: `${YEAR}-01-01` }, ad), "sync");
    ok(await ess.m("a", "accountingGeneral.sync", { startDate: `${YEAR}-01-01` }, ad), "sync 2");
    if (!s.invId) return { keys: [] as string[] };
    const abonoIds = (await ess.sql("a", "SELECT id FROM invoices WHERE creditNoteForId = ? AND invoiceType = 'abono'", [s.invId])).map((x: any) => x.id);
    const keys = [`inv:${s.invId}`, `cobro:${s.invId}`, ...abonoIds.map((i: number) => `inv:${i}`)];
    const rows = ((await ess.sql("a", "SELECT source_key AS k FROM acc_entries WHERE reversed_by_entry_id IS NULL AND source_key IS NOT NULL")) as any[]).map((r) => String(r.k).split("#")[0]).filter((k) => keys.includes(k));
    return { keys: rows.sort() };
  }

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "anul");
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: unknown) => {
      const target = String(input instanceof URL ? input.href : typeof input === "string" ? input : (input as { url: string }).url);
      if (/stripe|redsys|sermepa/i.test(target)) gateway.push(target);
      return inner(input as any, init as any);
    }) as typeof fetch;
    ad = await ess.login("a", "admin");
    adB = await ess.login("b", "admin");
    await ess.markPaid("a");
    await ess.markPaid("b");
    await ess.setCapability("a", "accounting-general", "active");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  // ---------- secuenciales (línea base de comportamiento) ----------
  it("SECUENCIAL total con devolución: un DEV, un abono, un asiento; el reintento se rechaza y nada cambia", async () => {
    const s = await seed();
    const c0 = await counters();
    const a = ok(await accept(s.reqId!), "aceptar");
    const m = await measure(s);
    expect(m.dev).toHaveLength(1);
    expect(m.devAmounts).toEqual([-121]);
    expect(m.abonos).toHaveLength(1);
    expect(m.abonoTotals).toEqual([-121]);
    expect(m.invoice).toBe("abonada");
    expect(m.reservation).toBe("cancelled");
    expect(a.creditNoteNumber).toBe(m.abonos[0]);
    const c1 = await counters();
    expect([c1.anulacion - c0.anulacion, c1.abono - c0.abono]).toEqual([1, 1]);
    expect((await accept(s.reqId!)).status).not.toBe(200);
    expect((await direct(s.resId)).status).not.toBe(200);
    expect(await measure(s)).toEqual(m);
    expect(await counters()).toEqual(c1); // el rechazo no consume números
    const e = await entriesOf(s);
    expect(e.keys).toEqual([`cobro:${s.invId}`, `inv:${s.invId}`, `inv:${m.abonoIds[0]}`].sort());
    expect(m.gateway).toBe(0);
  });

  it("SECUENCIAL reserva SIN factura: un DEV, ningún abono", async () => {
    const s = await seed({ invoice: false });
    ok(await accept(s.reqId!), "aceptar");
    const m = await measure(s);
    expect([m.dev.length, m.abonos.length, m.reservation]).toEqual([1, 0, "cancelled"]);
    expect((await accept(s.reqId!)).status).not.toBe(200);
    expect((await measure(s)).dev).toHaveLength(1);
  });

  it("SECUENCIAL parciales: por importe (DEV -50, abono -50) y por líneas (DEV -30, sin abono, reserva reducida una vez)", async () => {
    const s1 = await seed();
    ok(await accept(s1.reqId!, { refundAmount: 50, isPartial: true }), "importe");
    const m1 = await measure(s1);
    expect([m1.devAmounts, m1.abonoTotals]).toEqual([[-50], [-50]]);
    const s2 = await seed({ extras: true });
    ok(await accept(s2.reqId!, LINE), "líneas");
    const m2 = await measure(s2);
    expect([m2.devAmounts, m2.abonos.length, m2.invoice, m2.reservation, m2.amountTotalCents]).toEqual([[-30], 0, "cobrada", "paid", 9100]);
    expect((await accept(s2.reqId!, LINE)).status).not.toBe(200);
    expect((await measure(s2)).amountTotalCents).toBe(9100);
  });

  it("SECUENCIAL bono y «ninguna»: abono por el TOTAL de la factura, sin DEV; una sola vez", async () => {
    const s = await seed();
    ok(await accept(s.reqId!, { compensationType: "bono", refundAmount: undefined, voucherValue: 121, activityName: "Bono QA" }), "bono");
    const m = await measure(s);
    expect([m.dev.length, m.abonoTotals]).toEqual([0, [-121]]);
    const v = await one("SELECT COUNT(*) AS n FROM compensation_vouchers WHERE request_id = ?", [s.reqId]);
    expect(Number(v.n)).toBe(1);
    const s2 = await seed({ request: false });
    ok(await direct(s2.resId, { compensationType: "ninguna", refundAmount: undefined }), "ninguna");
    const m2 = await measure(s2);
    expect([m2.dev.length, m2.abonoTotals, m2.requests]).toEqual([0, [-121], 1]);
  });

  it("REVERTIR y aceptar de nuevo no duplica DEV ni abono (la segunda aceptación se rechaza: la reserva ya está anulada y devuelta)", async () => {
    const s = await seed();
    ok(await accept(s.reqId!), "aceptar");
    const m = await measure(s);
    ok(await ess.m("a", "cancellations.revertResolution", { id: s.reqId, reason: "prueba" }, ad), "revertir");
    const again = await accept(s.reqId!);
    expect(again.status).not.toBe(200);
    const m2 = await measure(s);
    expect([m2.dev, m2.abonos]).toEqual([m.dev, m.abonos]);
  });

  it("«por líneas» SIN lista de líneas se ejecuta como total, pero sigue siendo una sola operación", async () => {
    const s = await seed({ extras: true });
    ok(await accept(s.reqId!, { cancellationScope: "lineas", cancelledItems: undefined }), "aceptar");
    const m = await measure(s);
    expect([m.dev.length, m.abonos.length, m.reservation]).toEqual([1, 1, "cancelled"]);
  });

  // ---------- concurrencia ----------
  for (const n of SIZES) {
    for (const round of [1, 2]) {
      it(`SIMULTÁNEA ${n}x aceptar la misma anulación total (ronda ${round}): una sola efectiva, un DEV, un abono, un asiento`, async () => {
        const s = await seed();
        const c0 = await counters();
        const rs = await Promise.all(Array.from({ length: n }, () => accept(s.reqId!)));
        const m = await measure(s);
        console.log(`[ACEPTAR ${n} r${round}]`, JSON.stringify({ http200: rs.filter((r) => r.status === 200).length, ...m }));
        expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
        expect([m.dev.length, m.abonos.length, m.anuNumbers.length]).toEqual([1, 1, 1]);
        expect([m.devAmounts, m.abonoTotals, m.invoice, m.reservation]).toEqual([[-121], [-121], "abonada", "cancelled"]);
        const c1 = await counters();
        expect([c1.anulacion - c0.anulacion, c1.abono - c0.abono]).toEqual([1, 1]);
        expect(c1.factura - c0.factura).toBeLessThanOrEqual(1);
        const e = await entriesOf(s);
        expect(e.keys).toEqual([`cobro:${s.invId}`, `inv:${s.invId}`, `inv:${m.abonoIds[0]}`].sort());
        expect(m.gateway).toBe(0);
      });

      it(`SIMULTÁNEA ${n}x anulación directa de la misma reserva (ronda ${round}): una solicitud, un DEV, un abono, un asiento`, async () => {
        const s = await seed({ request: false });
        const c0 = await counters();
        const rs = await Promise.all(Array.from({ length: n }, () => direct(s.resId)));
        const m = await measure(s);
        console.log(`[DIRECTA ${n} r${round}]`, JSON.stringify({ http200: rs.filter((r) => r.status === 200).length, ...m }));
        expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
        expect([m.requests, m.dev.length, m.abonos.length]).toEqual([1, 1, 1]);
        expect([m.devAmounts, m.abonoTotals, m.invoice]).toEqual([[-121], [-121], "abonada"]);
        const c1 = await counters();
        expect([c1.anulacion - c0.anulacion, c1.abono - c0.abono]).toEqual([1, 1]);
        const e = await entriesOf(s);
        expect(e.keys).toEqual([`cobro:${s.invId}`, `inv:${s.invId}`, `inv:${m.abonoIds[0]}`].sort());
        expect(m.gateway).toBe(0);
      });

      it(`SIMULTÁNEA ${n}x anular la misma línea (ronda ${round}): un DEV de -30 y la reserva baja UNA vez`, async () => {
        const s = await seed({ extras: true });
        const rs = await Promise.all(Array.from({ length: n }, () => accept(s.reqId!, LINE)));
        const m = await measure(s);
        console.log(`[LINEA ${n} r${round}]`, JSON.stringify({ http200: rs.filter((r) => r.status === 200).length, ...m }));
        expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
        expect([m.devAmounts, m.abonos.length, m.amountTotalCents, m.invoice, m.anuNumbers.length]).toEqual([[-30], 0, 9100, "cobrada", 1]);
        expect(m.gateway).toBe(0);
      });
    }
  }

  it("SIMULTÁNEA 12x aceptar con compensación en BONO: un abono por el total, ningún DEV, un solo bono", async () => {
    const s = await seed();
    const rs = await Promise.all(Array.from({ length: 12 }, () => accept(s.reqId!, { compensationType: "bono", refundAmount: undefined, voucherValue: 121, activityName: "Bono QA" })));
    const m = await measure(s);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect([m.dev.length, m.abonoTotals]).toEqual([0, [-121]]);
    expect(Number((await one("SELECT COUNT(*) AS n FROM compensation_vouchers WHERE request_id = ?", [s.reqId])).n)).toBe(1);
    expect(Number((await one("SELECT COUNT(*) AS n FROM discount_codes WHERE observations LIKE ?", [`%anulación #${s.reqId}.%`])).n)).toBe(1);
  });

  it("SIMULTÁNEA 12x «por líneas» sin lista (= total): un DEV y un abono", async () => {
    const s = await seed({ extras: true });
    const rs = await Promise.all(Array.from({ length: 12 }, () => accept(s.reqId!, { cancellationScope: "lineas", cancelledItems: undefined })));
    const m = await measure(s);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect([m.dev.length, m.abonos.length]).toEqual([1, 1]);
  });

  it("SIMULTÁNEA 12x reserva SIN factura: un DEV y ningún abono", async () => {
    const s = await seed({ invoice: false });
    const rs = await Promise.all(Array.from({ length: 12 }, () => accept(s.reqId!)));
    const m = await measure(s);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect([m.dev.length, m.abonos.length]).toEqual([1, 0]);
  });

  it("SIMULTÁNEA mezclada: 6 aceptaciones + 6 directas sobre la misma reserva: un DEV y un abono", async () => {
    const s = await seed();
    const rs = await Promise.all([...Array.from({ length: 6 }, () => accept(s.reqId!)), ...Array.from({ length: 6 }, () => direct(s.resId))]);
    const m = await measure(s);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect([m.dev.length, m.abonos.length]).toEqual([1, 1]);
  });

  it("SIMULTÁNEA 12x marcar devolución ejecutada: una sola vez y un solo correo", async () => {
    const s = await seed();
    ok(await accept(s.reqId!), "aceptar");
    const mails0 = ess.mails.filter((x) => /Devolución realizada/.test(x.subject)).length;
    const rs = await Promise.all(Array.from({ length: 12 }, () => ess.m("a", "cancellations.markRefundExecuted", { id: s.reqId }, ad)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(ess.mails.filter((x) => /Devolución realizada/.test(x.subject)).length - mails0).toBe(1);
    expect((await measure(s)).dev).toHaveLength(1);
  });

  // ---------- fallos intermedios ----------
  it("FALLO tras consumir números: la transacción se revierte entera (sin DEV, abono, anulación, estado a medias ni números gastados)", async () => {
    await ess.sql("a", "DROP TRIGGER IF EXISTS p0_fallo_dev");
    await ess.sql("a", "CREATE TRIGGER p0_fallo_dev BEFORE INSERT ON transactions FOR EACH ROW BEGIN IF NEW.type = 'reembolso' AND NEW.clientName = 'CLIENTE FALLO' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fallo inyectado'; END IF; END");
    try {
      const s = await seed({ fullName: "CLIENTE FALLO" });
      const c0 = await counters();
      const before = await measure(s);
      const r = await accept(s.reqId!);
      expect(r.status).not.toBe(200);
      const m = await measure(s);
      expect([m.dev.length, m.abonos.length, m.anuNumbers.length, m.reservation, m.invoice]).toEqual([0, 0, 0, "paid", "cobrada"]);
      expect(m).toEqual(before);
      const rq = await one("SELECT resolution_status AS r, financial_status AS f, compensation_type AS c FROM cancellation_requests WHERE id = ?", [s.reqId]);
      expect([rq.r, rq.f]).toEqual(["sin_resolver", "sin_compensacion"]);
      expect(await counters()).toEqual(c0); // ningún número gastado
      expect((await one("SELECT status FROM transactions WHERE type='ingreso' AND reservationId_tx = ?", [s.resId])).status).toBe("completado");
      // la directa también se revierte entera, y no deja solicitud huérfana
      const s2 = await seed({ fullName: "CLIENTE FALLO", request: false });
      const d = await direct(s2.resId);
      expect(d.status).not.toBe(200);
      const m2 = await measure(s2);
      expect([m2.requests, m2.dev.length, m2.abonos.length, m2.reservation]).toEqual([0, 0, 0, "paid"]);
      expect(await counters()).toEqual(c0);
    } finally {
      await ess.sql("a", "DROP TRIGGER IF EXISTS p0_fallo_dev");
    }
    // tras quitar el fallo, el reintento funciona y consume exactamente un número de cada serie
    const s3 = await seed();
    const c0 = await counters();
    ok(await accept(s3.reqId!), "aceptar tras fallo");
    const c1 = await counters();
    expect([c1.anulacion - c0.anulacion, c1.abono - c0.abono]).toEqual([1, 1]);
  });

  // ---------- aislamiento y compatibilidad histórica ----------
  it("AISLAMIENTO: anulaciones simultáneas en dos empresas no se afectan; la otra empresa no ve ni toca la solicitud", async () => {
    const sa = await seed();
    const sb = await seed({ co: "b" });
    const cb0 = await counters("b");
    const [ra, rb] = await Promise.all([
      Promise.all(Array.from({ length: 6 }, () => accept(sa.reqId!))),
      Promise.all(Array.from({ length: 6 }, () => accept(sb.reqId!, {}, adB, "b"))),
    ]);
    expect(ra.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rb.filter((r) => r.status === 200)).toHaveLength(1);
    const ma = await measure(sa);
    const mb = await measure(sb, "b");
    expect([ma.dev.length, ma.abonos.length, mb.dev.length, mb.abonos.length]).toEqual([1, 1, 1, 1]);
    const cb1 = await counters("b");
    expect([cb1.anulacion - cb0.anulacion, cb1.abono - cb0.abono]).toEqual([1, 1]);
    // un administrador de A no puede resolver una solicitud que solo existe en B (el id no existe en A)
    const ghost = (await one("SELECT COALESCE(MAX(id), 0) + 1000 AS n FROM cancellation_requests")).n;
    expect((await accept(Number(ghost))).status).not.toBe(200);
  });

  it("HISTÓRICOS (DEV-0119, DEV-0470, abonos antiguos): ni una fila histórica cambia y los contadores de años anteriores no se tocan", async () => {
    await ess.sql("a", "INSERT INTO transactions (transactionNumber, type, amount, currency, status) VALUES (?, 'reembolso', -1.00, 'EUR', 'completado'), (?, 'reembolso', -1.00, 'EUR', 'completado')", [`DEV-${YEAR}-0470`, `DEV-${YEAR}-0119`]);
    await ess.sql("a", "INSERT INTO invoices (invoiceNumber, clientName, subtotal, taxRate, taxAmount, total, status, invoiceType, issuedAt) VALUES ('F-HIST-1', 'Hist', 100, 21, 21, 121, 'abonada', 'factura', '2025-03-01'), ('ABN-2025-0001', 'Hist', -100, 21, -21, -121, 'generada', 'abono', '2025-03-02')");
    await ess.sql("a", "UPDATE invoices SET creditNoteForId = (SELECT id FROM (SELECT id FROM invoices WHERE invoiceNumber = 'F-HIST-1') x) WHERE invoiceNumber = 'ABN-2025-0001'");
    await ess.sql("a", "INSERT INTO document_counters (document_type, `year`, current_number, prefix) VALUES ('abono', 2025, 13, 'ABN')");
    const snap = async () => ({
      tx: await ess.sql("a", "SELECT id, transactionNumber, type, amount, status, operationStatus, reservationId_tx FROM transactions WHERE id <= (SELECT MAX(id) FROM transactions)  AND (transactionNumber LIKE 'DEV-%0470' OR transactionNumber LIKE 'DEV-%0119') ORDER BY id"),
      inv: await ess.sql("a", "SELECT id, invoiceNumber, total, status, creditNoteForId, issuedAt FROM invoices WHERE invoiceNumber IN ('F-HIST-1','ABN-2025-0001') ORDER BY id"),
      old: await ess.sql("a", "SELECT document_type, `year`, current_number, prefix FROM document_counters WHERE `year` < ? ORDER BY id", [YEAR]),
    });
    const s = await seed();
    const before = await snap();
    const prevAll = await ess.sql("a", "SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT(transactionNumber,'|',amount,'|',status))),0) AS h FROM transactions WHERE id < (SELECT MIN(id) FROM transactions WHERE transactionNumber = ?)", [`TX-a-${seq}`]);
    await Promise.all(Array.from({ length: 6 }, () => accept(s.reqId!)));
    const m = await measure(s);
    expect([m.dev.length, m.abonos.length]).toEqual([1, 1]);
    expect(m.dev[0]).not.toMatch(/-(0119|0470)$/);
    expect(await snap()).toEqual(before);
    const nowAll = await ess.sql("a", "SELECT COUNT(*) AS n, COALESCE(SUM(CRC32(CONCAT(transactionNumber,'|',amount,'|',status))),0) AS h FROM transactions WHERE id < (SELECT MIN(id) FROM transactions WHERE transactionNumber = ?)", [`TX-a-${seq}`]);
    expect(nowAll).toEqual(prevAll);
  });

  it("la pasarela no se llama nunca (0 intentos a Stripe/Redsys en toda la suite)", () => {
    expect(gateway).toEqual([]);
  });
});
