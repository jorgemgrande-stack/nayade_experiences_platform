/**
 * EXPEDIENTE DE INTEGRIDAD FUNCIONAL (auditoría 22/11/2026) — pruebas de CARACTERIZACIÓN con la aplicación real
 * sobre MySQL aislado (opt-in, REGISTRY_TEST_DATABASE_URL). Empresas sintéticas nuevas, datos ficticios
 * (@ejemplo.invalid), sin correo ni cobros reales: el cobro es la confirmación manual de siempre.
 *
 * Cada prueba afirma el comportamiento OBSERVADO HOY. Las marcadas «DEFECTO» documentan un fallo: al corregirlo
 * deben invertirse (el expediente indica la aserción correcta en el comentario «DESPUÉS»).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33992/registro_test \
 *     pnpm vitest run server/integridad.auditoria.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp, type Res } from "./essentialApp.testkit";
import { resetProductRequestLimits } from "./productRequests";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 120_000 });
const TAG = Date.now().toString(36);
let seq = 0;
const mail = () => `cliente${++seq}.${TAG}@ejemplo.invalid`;

describe.skipIf(!URL_)("Integridad funcional del circuito presupuesto → cobro → factura (aplicación real)", () => {
  let ess: EssentialApp;
  let adm = "";
  let ag = "";
  const prod = { fixed: 0, onReq: 0, priced: 0, variant: 0 };
  const log = (k: string, v: unknown) => console.log(`[INTEGRIDAD] ${k}: ${JSON.stringify(v)}`);

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 600)}`);
    return data(r);
  };
  /** Solicitud de producto en modo de pruebas (misma ruta que la ficha pública, sin avisos). */
  const request = async (experienceId: number, variantId?: number) => {
    resetProductRequestLimits();
    const r = ok(await ess.m("a", "crm.leads.submitTestRequest", { experienceId, ...(variantId ? { variantId } : {}), name: "Persona Sintética", email: mail() }, adm), "solicitud");
    return Number(r.leadId);
  };
  const quoteFrom = async (leadId: number) => Number(ok(await ess.m("a", "crm.leads.generateFromLead", { leadId }, adm), "generateFromLead").quoteId);
  const pay = (quoteId: number, cookie = adm) => ess.m("a", "crm.quotes.confirmPayment", { quoteId, paymentMethod: "efectivo", paymentNote: "Pago sintético" }, cookie);
  const invoicesOf = (quoteId: number) => ess.sql("a", "SELECT id, invoiceNumber, status, reservationId, total FROM invoices WHERE quoteId = ? ORDER BY id", [quoteId]);
  /** Presupuesto con producto de precio fijo, listo para cobrar. */
  const freshQuote = async () => quoteFrom(await request(prod.fixed));

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "integr");
    adm = await ess.login("a", "admin");
    ag = await ess.login("a", "agente");
    await ess.markPaid("a");
    ok(await ess.m("a", "products.createCategory", { slug: "servicios", name: "Servicios" }, adm), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, adm), "lugar");
    const cat = (await ess.sql("a", "SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await ess.sql("a", "SELECT id FROM locations LIMIT 1"))[0].id;
    const base = { productType: "own", categoryId: cat, locationId: loc };
    const mk = async (slug: string, title: string, offerMode: string, basePrice: string) => {
      ok(await ess.m("a", "products.create", { ...base, slug: `${slug}-${TAG}`, title, offerMode, basePrice }, adm), title);
      return Number((await ess.sql("a", "SELECT id FROM experiences WHERE slug = ?", [`${slug}-${TAG}`]))[0].id);
    };
    prod.fixed = await mk("fijo", "Servicio precio fijo", "priced_request", "400.00");
    prod.onReq = await mk("bajopeticion", "Retiro bajo petición", "on_request", "0.00");
    prod.priced = await mk("conmodalidad", "Retiro con modalidades", "priced_request", "400.00");
    ok(await ess.m("a", "products.createVariant", { experienceId: prod.priced, name: "Modalidad premium", priceModifier: "900.00", priceType: "fixed" }, adm), "modalidad");
    prod.variant = Number((await ess.sql("a", "SELECT id FROM experience_variants WHERE experienceId = ?", [prod.priced]))[0].id);
  }, 300_000);

  afterAll(async () => {
    await ess?.close();
  });

  // ───────────────────────── 1. Borrar presupuestos y facturas ─────────────────────────
  describe("1. quotes.delete / bulkDelete y las facturas", () => {
    it("CORREGIDO (F1): quotes.delete de un presupuesto COBRADO se rechaza y conserva factura, reserva y presupuesto", async () => {
      const q = await freshQuote();
      ok(await pay(q), "cobro");
      const [inv] = await invoicesOf(q);
      expect(inv, "el cobro emitió factura").toBeTruthy();
      const before = (await ess.sql("a", "SELECT id, invoiceId, invoiceNumber FROM reservations WHERE id = ?", [inv.reservationId]))[0];
      expect(Number(before.invoiceId)).toBe(Number(inv.id));

      const r = await ess.m("a", "crm.quotes.delete", { id: q }, ag); // rol agente: el mínimo de «staff»
      log("quotes.delete por agente → HTTP", r.status);

      const after = await invoicesOf(q);
      const gone = (await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices WHERE invoiceNumber = ?", [inv.invoiceNumber]))[0].n;
      const resv = (await ess.sql("a", "SELECT id, invoiceId, invoiceNumber FROM reservations WHERE id = ?", [inv.reservationId]))[0];
      log("factura tras borrar presupuesto", { facturasDelPresupuesto: after.length, conEseNumero: Number(gone), reservaConserva: resv });
      // OBSERVADO HOY: la factura desaparece; la reserva sigue apuntando a una factura que ya no existe.
      // DESPUÉS: r.status ≠ 200 (FORBIDDEN/CONFLICT) y la factura sigue en BD.
      expect(r.status).toBe(409);
      expect(r.json?.error?.json?.message).toMatch(/factura emitida/);
      expect(after.length).toBe(1);
      expect(Number(gone)).toBe(1);
      expect(Number(resv.invoiceId)).toBe(Number(inv.id));
      expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM quotes WHERE id = ?", [q]))[0].n).toBe(1);
    });

    it("CORREGIDO (F1): quotes.bulkDelete rechaza el lote entero (nada se borra) si algún presupuesto tiene factura", async () => {
      const qs = [await freshQuote(), await freshQuote()];
      for (const q of qs) ok(await pay(q), "cobro");
      const nums = (await Promise.all(qs.map(invoicesOf))).flat().map((i) => i.invoiceNumber);
      expect(nums.length).toBe(2);
      const r = await ess.m("a", "crm.quotes.bulkDelete", { ids: qs }, ag);
      const left = (await ess.sql("a", `SELECT COUNT(*) AS n FROM invoices WHERE invoiceNumber IN (${nums.map(() => "?").join(",")})`, nums))[0].n;
      log("bulkDelete → HTTP / facturas que quedan", { status: r.status, quedan: Number(left), eran: nums.length });
      expect(r.status).toBe(409);
      expect(Number(left)).toBe(nums.length);
    });

    it("CONTRASTE: invoices.delete directo sí rechaza (la regla fiscal existe, pero solo en esa ruta)", async () => {
      const q = await freshQuote();
      ok(await pay(q), "cobro");
      const [inv] = await invoicesOf(q);
      const r = await ess.m("a", "crm.invoices.delete", { invoiceId: inv.id }, adm);
      expect(r.status).toBe(403);
      expect((await invoicesOf(q)).length).toBe(1);
    });

    it("HIPÓTESIS DESCARTADA/CONFIRMADA: la BD no protege (sin clave ajena invoices.quoteId)", async () => {
      const fk = await ess.sql("a", "SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'quoteId' AND REFERENCED_TABLE_NAME IS NOT NULL");
      log("claves ajenas de invoices.quoteId", fk);
      expect(fk.length).toBe(0);
    });
  });

  // ───────────────────────── 2. Duplicación de facturas por reintento ─────────────────────────
  describe("2. confirmPayment: reintentos y simultaneidad", () => {
    it("CONTROL: cobrar dos veces en serie NO duplica (la idempotencia existente funciona)", async () => {
      const q = await freshQuote();
      const a = ok(await pay(q), "cobro 1");
      const b = ok(await pay(q), "cobro 2");
      expect(b.invoiceId).toBe(a.invoiceId);
      expect((await invoicesOf(q)).length).toBe(1);
    });

    it("CORREGIDO (F2a): 6 cobros a la vez sobre el mismo presupuesto (3 rondas) → UNA factura", async () => {
      const result: Array<{ facturas: number; reservas: number; estados: number[] }> = [];
      for (let round = 0; round < 3; round++) {
        const q = await freshQuote();
        const rs = await Promise.all(Array.from({ length: 6 }, () => pay(q)));
        const inv = await invoicesOf(q);
        const res = (await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations WHERE notes LIKE ?", [`%${(await ess.sql("a", "SELECT quoteNumber FROM quotes WHERE id = ?", [q]))[0].quoteNumber}%`]))[0].n;
        result.push({ facturas: inv.length, reservas: Number(res), estados: rs.map((r) => r.status) });
      }
      log("ronda → facturas/reservas", result);
      // F2a: serializado por presupuesto → una sola factura y una sola reserva por ronda, y todas las respuestas apuntan a ella.
      for (const r of result) { expect(r.facturas).toBe(1); expect(r.reservas).toBe(1); }
    });

    const counterOf = async () => Number((await ess.sql("a", "SELECT current_number AS n FROM document_counters WHERE document_type = 'factura' ORDER BY id DESC LIMIT 1"))[0]?.n ?? 0);
    const withFailingReservation = async <T>(fn: () => Promise<T>): Promise<T> => {
      await ess.sql("a", "CREATE TRIGGER audit_fail_res BEFORE INSERT ON reservations FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fallo inyectado'");
      try { return await fn(); } finally { await ess.sql("a", "DROP TRIGGER IF EXISTS audit_fail_res"); }
    };

    it("CORREGIDO (F2b): un fallo a medias NO deja factura huérfana ni consume número, y el reintento emite UNA factura", async () => {
      const q = await freshQuote();
      const before = await counterOf();
      const first = await withFailingReservation(() => pay(q));
      const afterFail = await invoicesOf(q);
      const quoteRow = (await ess.sql("a", "SELECT status, paidAt FROM quotes WHERE id = ?", [q]))[0];
      const counterAfterFail = await counterOf();
      log("tras el fallo inyectado", { http: first.status, facturas: afterFail.length, presupuesto: quoteRow, contador: [before, counterAfterFail] });
      expect(first.status).not.toBe(200);
      expect(afterFail.length).toBe(0); // sin factura huérfana
      expect(quoteRow.paidAt).toBeNull(); // el presupuesto sigue sin cobrar
      expect(counterAfterFail).toBe(before); // el número no se consumió: sin hueco en la serie

      const second = await pay(q);
      const afterRetry = await invoicesOf(q);
      log("tras el reintento", { http: second.status, facturas: afterRetry });
      expect(second.status).toBe(200);
      expect(afterRetry.length).toBe(1);
      expect(await counterOf()).toBe(before + 1);
      expect(afterRetry[0].invoiceNumber).toMatch(new RegExp("-" + String(before + 1).padStart(4, "0") + "$"));
    });

    it("numeración: 8 cobros simultáneos de presupuestos distintos dan números únicos y correlativos (sin huecos)", async () => {
      const qs: number[] = [];
      for (let i = 0; i < 8; i++) qs.push(await freshQuote());
      const before = await counterOf();
      const rs = await Promise.all(qs.map((q) => pay(q)));
      expect(rs.every((r) => r.status === 200)).toBe(true);
      const nums = (await ess.sql("a", "SELECT invoiceNumber FROM invoices WHERE quoteId IN (" + qs.join(",") + ")")).map((r: any) => Number(String(r.invoiceNumber).split("-").pop()));
      nums.sort((x: number, y: number) => x - y);
      log("números", nums);
      expect(new Set(nums).size).toBe(8);
      expect(nums).toEqual(Array.from({ length: 8 }, (_, i) => before + 1 + i));
    });

    it("OTRAS RUTAS: confirmTransfer ×6 simultáneos → UNA factura y UNA reserva", async () => {
      const q = await freshQuote();
      await ess.sql("a", "UPDATE quotes SET transfer_proof_url = 'https://ejemplo.invalid/justificante.pdf' WHERE id = ?", [q]);
      const rs = await Promise.all(Array.from({ length: 6 }, () => ess.m("a", "crm.quotes.confirmTransfer", { quoteId: q }, adm)));
      log("confirmTransfer", rs.map((r) => r.status));
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect((await invoicesOf(q)).length).toBe(1);
      const qn = (await ess.sql("a", "SELECT quoteNumber FROM quotes WHERE id = ?", [q]))[0].quoteNumber;
      expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations WHERE notes LIKE ?", ["%" + qn + "%"]))[0].n)).toBe(1);
    });

    it("OTRAS RUTAS: confirmTransfer + confirmPayment mezclados y simultáneos → UNA factura", async () => {
      const q = await freshQuote();
      await ess.sql("a", "UPDATE quotes SET transfer_proof_url = 'https://ejemplo.invalid/justificante.pdf' WHERE id = ?", [q]);
      const rs = await Promise.all([
        pay(q), ess.m("a", "crm.quotes.confirmTransfer", { quoteId: q }, adm),
        pay(q), ess.m("a", "crm.quotes.confirmTransfer", { quoteId: q }, adm),
      ]);
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect((await invoicesOf(q)).length).toBe(1);
    });

    it("OTRAS RUTAS: fallo a medias en confirmTransfer tampoco deja factura ni consume número", async () => {
      const q = await freshQuote();
      await ess.sql("a", "UPDATE quotes SET transfer_proof_url = 'https://ejemplo.invalid/justificante.pdf' WHERE id = ?", [q]);
      const before = await counterOf();
      const first = await withFailingReservation(() => ess.m("a", "crm.quotes.confirmTransfer", { quoteId: q }, adm));
      expect(first.status).not.toBe(200);
      expect((await invoicesOf(q)).length).toBe(0);
      expect(await counterOf()).toBe(before);
      const second = await ess.m("a", "crm.quotes.confirmTransfer", { quoteId: q }, adm);
      expect(second.status).toBe(200);
      expect((await invoicesOf(q)).length).toBe(1);
    });

    it("OTRAS RUTAS: convertToReservation ×6 simultáneos → UNA reserva", async () => {
      const q = await freshQuote();
      const rs = await Promise.all(Array.from({ length: 6 }, () => ess.m("a", "crm.quotes.convertToReservation", { quoteId: q }, adm)));
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations WHERE quote_id = ? AND status <> 'cancelled'", [q]))[0].n)).toBe(1);
    });

    it("OTRAS RUTAS: confirmManualPayment ×6 sobre la misma factura → solo UNA pasa a cobrada, el resto se rechaza", async () => {
      const q = await freshQuote();
      const paid = ok(await pay(q), "cobro");
      const rs = await Promise.all(Array.from({ length: 6 }, () => ess.m("a", "crm.invoices.confirmManualPayment", { invoiceId: paid.invoiceId, paymentMethod: "transferencia" }, adm)));
      const codes = rs.map((r) => r.status).sort();
      log("confirmManualPayment", codes);
      expect(codes.filter((c) => c === 200).length).toBe(1);
      expect(codes.filter((c) => c === 400).length).toBe(5);
    });

    it("OTRAS RUTAS: pendingPayments.confirm ×6 → un solo cobro y UNA factura para la reserva", async () => {
      const q = await freshQuote();
      ok(await ess.m("a", "crm.quotes.convertToReservation", { quoteId: q }, adm), "convertir");
      const resId = Number((await ess.sql("a", "SELECT id FROM reservations WHERE quote_id = ? LIMIT 1", [q]))[0].id);
      ok(await ess.m("a", "crm.pendingPayments.create", { quoteId: q, reservationId: resId, clientName: "Persona Sintética", productName: "Servicio sintético", amountCents: 40000, dueDate: "2027-01-01", reason: "prueba" }, adm), "pago pendiente");
      const pp = Number((await ess.sql("a", "SELECT id FROM pending_payments WHERE quote_id = ? LIMIT 1", [q]))[0].id);
      const rs = await Promise.all(Array.from({ length: 6 }, () => ess.m("a", "crm.pendingPayments.confirm", { id: pp, paymentMethod: "efectivo" }, adm)));
      const codes = rs.map((r) => r.status).sort();
      log("pendingPayments.confirm", codes);
      expect(codes.filter((c) => c === 200).length).toBe(1);
      expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices WHERE reservationId = ?", [resId]))[0].n)).toBe(1);
    });
  });

  // ───────────────────────── 3. Presupuestos de 0 € / precio equivocado ─────────────────────────
  describe("3. generateFromLead desde solicitudes de producto", () => {
    it("DEFECTO: producto «bajo petición» → presupuesto de 0 €", async () => {
      const lead = await request(prod.onReq);
      const q = await quoteFrom(lead);
      const row = (await ess.sql("a", "SELECT total, items, status FROM quotes WHERE id = ?", [q]))[0];
      log("bajo petición → presupuesto", { total: row.total, items: row.items, status: row.status });
      expect(Number(row.total)).toBe(0);
    });

    it("CORREGIDO (F3): «precio visible solo por solicitud» con modalidad de 900 € → el presupuesto sale a 900 €, el precio mostrado", async () => {
      const lead = await request(prod.priced, prod.variant);
      const l = (await ess.sql("a", "SELECT variant_id AS variantId, variant_label AS variantLabel, shown_price AS shownPrice FROM leads WHERE id = ?", [lead]))[0];
      const q = await quoteFrom(lead);
      const row = (await ess.sql("a", "SELECT total, items FROM quotes WHERE id = ?", [q]))[0];
      log("lead (modalidad y precio mostrado) → presupuesto", { lead: l, total: row.total, items: row.items });
      expect(Number(l.shownPrice)).toBe(900);
      expect(Number(row.total)).toBe(900);
    });

    it("CONTROL: el envío de un presupuesto a 0 € está bloqueado (o no): se registra", async () => {
      const lead = await request(prod.onReq);
      const q = await quoteFrom(lead);
      const r = await ess.m("a", "crm.quotes.send", { id: q }, adm);
      log("quotes.send con total 0 → HTTP / código", { status: r.status, code: errCode(r), msg: r.json?.error?.json?.message });
      expect(typeof r.status).toBe("number");
    });

    it("DEFECTO: generateFromLead repetido crea presupuestos duplicados (no idempotente)", async () => {
      const lead = await request(prod.fixed);
      const q1 = await quoteFrom(lead);
      const q2 = await quoteFrom(lead);
      log("dos generateFromLead del mismo lead", { q1, q2 });
      expect(q2).not.toBe(q1);
    });
  });
});
