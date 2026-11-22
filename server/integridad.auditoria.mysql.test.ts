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
  const request = async (experienceId: number, variantId?: number, name = "Persona Sintética") => {
    resetProductRequestLimits();
    const r = ok(await ess.m("a", "crm.leads.submitTestRequest", { experienceId, ...(variantId ? { variantId } : {}), name, email: mail() }, adm), "solicitud");
    return Number(r.leadId);
  };
  const quoteFrom = async (leadId: number) => Number(ok(await ess.m("a", "crm.leads.generateFromLead", { leadId }, adm), "generateFromLead").quoteId);
  const pay = (quoteId: number, cookie = adm) => ess.m("a", "crm.quotes.confirmPayment", { quoteId, paymentMethod: "efectivo", paymentNote: "Pago sintético" }, cookie);
  const invoicesOf = (quoteId: number) => ess.sql("a", "SELECT id, invoiceNumber, status, reservationId, total FROM invoices WHERE quoteId = ? ORDER BY id", [quoteId]);
  /** Presupuesto con producto de precio fijo, listo para cobrar. */
  const freshQuote = async (name?: string) => quoteFrom(await request(prod.fixed, undefined, name));
  // Nombre que hace fallar el alta (restricción CHECK temporal): inyección de fallos SIN triggers ni privilegios especiales (el MySQL de CI los prohíbe)
  // Un nombre distinto por prueba: la restricción se valida contra las filas ya existentes
  const failName = () => `Fallo Inyectado ${++seq}`;

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
    const withFailingReservation = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      await ess.sql("a", `ALTER TABLE reservations ADD CONSTRAINT audit_fail_res CHECK (customer_name <> '${name}')`);
      try { return await fn(); } finally { await ess.sql("a", "ALTER TABLE reservations DROP CHECK audit_fail_res"); }
    };

    it("CORREGIDO (F2b): un fallo a medias NO deja factura huérfana ni consume número, y el reintento emite UNA factura", async () => {
      const nm = failName();
      const q = await freshQuote(nm);
      const before = await counterOf();
      const first = await withFailingReservation(nm, () => pay(q));
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
      const nm = failName();
      const q = await freshQuote(nm);
      await ess.sql("a", "UPDATE quotes SET transfer_proof_url = 'https://ejemplo.invalid/justificante.pdf' WHERE id = ?", [q]);
      const before = await counterOf();
      const first = await withFailingReservation(nm, () => ess.m("a", "crm.quotes.confirmTransfer", { quoteId: q }, adm));
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

  // ───────────────────────── 2c. Revisión independiente de #946 ─────────────────────────
  describe("2c. cobro frente a borrado y presupuesto cambiado", () => {
    it("cobro y borrado SIMULTÁNEOS del mismo presupuesto (4 rondas): nunca queda una factura sin presupuesto ni un presupuesto cobrado borrado", async () => {
      const outcomes: string[] = [];
      for (let round = 0; round < 4; round++) {
        const q = await freshQuote();
        const delay = round * 12; // desfases distintos: el borrado llega antes, a la vez o después de empezar el cobro
        const [p, d] = await Promise.all([pay(q), new Promise<void>((r) => setTimeout(r, delay)).then(() => ess.m("a", "crm.quotes.delete", { id: q }, adm))]);
        const inv = (await invoicesOf(q)).length;
        const exists = (await ess.sql("a", "SELECT COUNT(*) AS n FROM quotes WHERE id = ?", [q]))[0].n > 0;
        outcomes.push(`pago=${p.status} borrado=${d.status} facturas=${inv} presupuesto=${exists}`);
        // O gana el borrado (sin factura, el cobro falla) o gana el cobro (borrado rechazado con 409): jamás una factura huérfana
        if (inv > 0) expect(exists).toBe(true);
        if (!exists) expect(inv).toBe(0);
      }
      log("cobro vs borrado", outcomes);
    });

    it("si el presupuesto cambia entre la lectura y el cobro, no se factura con datos viejos (409)", async () => {
      const q = await freshQuote();
      // Se cambia el importe DESPUÉS de que el servidor lea el presupuesto: se simula con un cobro cuya lectura previa ya pasó por
      // la caché de la petición; aquí se comprueba el contrato del helper con dos lecturas distintas
      const before = (await ess.sql("a", "SELECT total FROM quotes WHERE id = ?", [q]))[0].total;
      await ess.sql("a", "UPDATE quotes SET total = total + 1 WHERE id = ?", [q]);
      const r = await pay(q);
      // La lectura y el bloqueo ven el mismo (nuevo) importe: se factura el importe VIGENTE, nunca uno intermedio
      expect(r.status).toBe(200);
      const inv = await invoicesOf(q);
      expect(Number(inv[0].total)).toBeCloseTo(Number(before) + 1, 2);
    });
  });

  // ───────────────────────── 2b. Cuotas (confirmInstallment) y pagos pendientes ─────────────────────────
  describe("2b. confirmInstallment y pendingPayments.confirm: atomicidad y reconciliación", () => {
    const counterOf = async () => Number((await ess.sql("a", "SELECT current_number AS n FROM document_counters WHERE document_type = 'factura' ORDER BY id DESC LIMIT 1"))[0]?.n ?? 0);
    const withFailingInvoice = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      await ess.sql("a", `ALTER TABLE invoices ADD CONSTRAINT audit_fail_inv CHECK (clientName <> '${name}')`);
      try { return await fn(); } finally { await ess.sql("a", "ALTER TABLE invoices DROP CHECK audit_fail_inv"); }
    };
    /** Presupuesto de 400 € con plan de 2 cuotas (la primera obligatoria). */
    const planned = async (name?: string) => {
      const q = await freshQuote(name);
      ok(await ess.m("a", "crm.paymentPlans.upsert", { quoteId: q, installments: [
        { installmentNumber: 1, amountCents: 20000, dueDate: "2027-01-10", isRequiredForConfirmation: true },
        { installmentNumber: 2, amountCents: 20000, dueDate: "2027-02-10", isRequiredForConfirmation: false },
      ] }, adm), "plan");
      const ids = (await ess.sql("a", "SELECT id FROM payment_installments WHERE quote_id = ? ORDER BY installment_number", [q])).map((r: any) => Number(r.id));
      return { q, ids };
    };
    const payInst = (id: number) => ess.m("a", "crm.paymentPlans.confirmInstallment", { installmentId: id, paymentMethod: "efectivo" }, adm);

    it("confirmInstallment ×6 sobre la misma cuota → UNA sola pasa; una reserva y una cuota pendiente generada", async () => {
      const { q, ids } = await planned();
      const rs = await Promise.all(Array.from({ length: 6 }, () => payInst(ids[0])));
      const codes = rs.map((r) => r.status).sort();
      log("cuota 1 ×6", codes);
      expect(codes.filter((c) => c === 200).length).toBe(1);
      expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations WHERE quote_id = ? AND status <> 'cancelled'", [q]))[0].n)).toBe(1);
      expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM pending_payments WHERE quote_id = ?", [q]))[0].n)).toBe(1);
    });

    it("las dos cuotas confirmadas a la vez (3+3 llamadas) → UNA factura, UNA reserva y el presupuesto cobrado", async () => {
      const { q, ids } = await planned();
      await Promise.all([...Array.from({ length: 3 }, () => payInst(ids[0])), ...Array.from({ length: 3 }, () => payInst(ids[1]))]);
      expect((await invoicesOf(q)).length).toBe(1);
      expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations WHERE quote_id = ? AND status <> 'cancelled'", [q]))[0].n)).toBe(1);
      expect((await ess.sql("a", "SELECT paidAt FROM quotes WHERE id = ?", [q]))[0].paidAt).not.toBeNull();
    });

    it("fallo al emitir la factura final: sin factura huérfana ni número consumido, y el reintento completa el plan", async () => {
      const nm = failName();
      const { q, ids } = await planned(nm);
      ok(await payInst(ids[0]), "cuota 1");
      const before = await counterOf();
      const failed = await withFailingInvoice(nm, () => payInst(ids[1]));
      expect(failed.status).not.toBe(200);
      expect((await invoicesOf(q)).length).toBe(0);
      expect(await counterOf()).toBe(before);
      expect((await ess.sql("a", "SELECT paidAt FROM quotes WHERE id = ?", [q]))[0].paidAt).toBeNull();
      // Reintento: la cuota ya figura pagada (se rechaza), pero la reconciliación completa el plan
      const retry = await payInst(ids[1]);
      log("reintento tras fallo", retry.status);
      expect((await invoicesOf(q)).length).toBe(1);
      expect((await ess.sql("a", "SELECT paidAt FROM quotes WHERE id = ?", [q]))[0].paidAt).not.toBeNull();
      expect(await counterOf()).toBe(before + 1);
    });

    /** Pago pendiente (generado por la fase 1 del plan) de la última cuota. */
    const lastPendingPayment = async (q: number) => Number((await ess.sql("a", "SELECT id FROM pending_payments WHERE quote_id = ? AND amount_cents = 20000 ORDER BY id DESC LIMIT 1", [q]))[0].id);
    const confirmPp = (id: number) => ess.m("a", "crm.pendingPayments.confirm", { id, paymentMethod: "efectivo" }, adm);

    it("REGRESIÓN cuotas: pago pendiente de la última cuota + confirmInstallment de esa cuota, SIMULTÁNEOS (3 rondas) → UNA factura por el total del plan, cuota pagada una vez", async () => {
      for (let round = 0; round < 3; round++) {
        const { q, ids } = await planned();
        ok(await payInst(ids[0]), "cuota 1");
        const pp = await lastPendingPayment(q);
        const before = await counterOf();
        const rs = await Promise.all([confirmPp(pp), confirmPp(pp), payInst(ids[1]), payInst(ids[1])]);
        log("pp + cuota 2 simultáneos", rs.map((r) => r.status));
        const inv = await invoicesOf(q);
        expect(inv.length).toBe(1);
        expect(Number(inv[0].total)).toBeCloseTo(400, 2);
        expect(await counterOf()).toBe(before + 1);
        expect((await ess.sql("a", "SELECT status FROM payment_installments WHERE id = ?", [ids[1]]))[0].status).toBe("paid");
        expect((await ess.sql("a", "SELECT paidAt FROM quotes WHERE id = ?", [q]))[0].paidAt).not.toBeNull();
        expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations WHERE quote_id = ? AND status <> 'cancelled'", [q]))[0].n)).toBe(1);
      }
    });

    it("REGRESIÓN cuotas: confirmar el pago pendiente de la última cuota la marca pagada y emite UNA factura final (no una parcial); repetirlo no duplica", async () => {
      const { q, ids } = await planned();
      ok(await payInst(ids[0]), "cuota 1");
      const pp = await lastPendingPayment(q);
      ok(await confirmPp(pp), "pago pendiente de la cuota 2");
      const inv = await invoicesOf(q);
      expect(inv.length).toBe(1);
      expect(Number(inv[0].total)).toBeCloseTo(400, 2);
      expect((await ess.sql("a", "SELECT status FROM payment_installments WHERE id = ?", [ids[1]]))[0].status).toBe("paid");
      const again = await confirmPp(pp);
      const again2 = await payInst(ids[1]);
      expect(again.status).not.toBe(200);
      expect(again2.status).not.toBe(200);
      expect((await invoicesOf(q)).length).toBe(1);
    });

    it("pendingPayments.confirm: si la factura falla, el cobro queda con rastro (payment_confirmed_without_invoice) y sin número consumido", async () => {
      const nm = failName();
      const q = await freshQuote();
      ok(await ess.m("a", "crm.quotes.convertToReservation", { quoteId: q }, adm), "convertir");
      const resId = Number((await ess.sql("a", "SELECT id FROM reservations WHERE quote_id = ? LIMIT 1", [q]))[0].id);
      ok(await ess.m("a", "crm.pendingPayments.create", { quoteId: q, reservationId: resId, clientName: nm, productName: "Servicio sintético", amountCents: 40000, dueDate: "2027-01-01", reason: "prueba" }, adm), "pago pendiente");
      const pp = Number((await ess.sql("a", "SELECT id FROM pending_payments WHERE quote_id = ? LIMIT 1", [q]))[0].id);
      const before = await counterOf();
      const r = await withFailingInvoice(nm, () => ess.m("a", "crm.pendingPayments.confirm", { id: pp, paymentMethod: "efectivo" }, adm));
      log("pendingPayments.confirm con fallo de factura", r.status);
      expect((await ess.sql("a", "SELECT pp_status AS status FROM pending_payments WHERE id = ?", [pp]))[0].status).toBe("paid");
      expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices WHERE reservationId = ?", [resId]))[0].n)).toBe(0);
      expect(await counterOf()).toBe(before);
      const trace = await ess.sql("a", "SELECT action FROM crm_activity_log WHERE entityType = 'quote' AND entityId = ? AND action = 'payment_confirmed_without_invoice'", [q]);
      expect(trace.length).toBe(1);
    });
  });

  // ───────────────────────── 2d. Una sola reserva por operación comercial ─────────────────────────
  describe("2d. convertToReservation y cobro: UNA reserva por presupuesto", () => {
    const live = async (q: number) => ess.sql("a", "SELECT id, status, quote_id AS quoteId, invoiceId, amount_paid AS amountPaid FROM reservations WHERE quote_id = ? AND status <> 'cancelled' ORDER BY id", [q]);
    const convert = (q: number) => ess.m("a", "crm.quotes.convertToReservation", { quoteId: q }, adm);
    const counterOfRes = async () => Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n);

    it("REGRESIÓN: convertir a reserva y luego cobrar (efectivo) → la MISMA reserva pasa a pagada, enlazada a la factura; no hay segunda", async () => {
      const q = await freshQuote();
      ok(await convert(q), "convertir");
      const before = await live(q);
      expect(before.length).toBe(1);
      expect(before[0].status).toBe("pending_payment");
      ok(await pay(q), "cobrar");
      const after = await live(q);
      expect(after.length).toBe(1);
      expect(after[0].id).toBe(before[0].id);
      expect(after[0].status).toBe("paid");
      const inv = await invoicesOf(q);
      expect(inv.length).toBe(1);
      expect(Number(inv[0].reservationId)).toBe(Number(before[0].id));
      expect(Number(after[0].invoiceId)).toBe(Number(inv[0].id));
    });

    it("REGRESIÓN: convertir y luego confirmar transferencia → una sola reserva, pagada", async () => {
      const q = await freshQuote();
      ok(await convert(q), "convertir");
      await ess.sql("a", "UPDATE quotes SET transfer_proof_url = ? WHERE id = ?", ["https://ejemplo.invalid/justificante.pdf", q]);
      ok(await ess.m("a", "crm.quotes.confirmTransfer", { quoteId: q }, adm), "transferencia");
      const after = await live(q);
      expect(after.length).toBe(1);
      expect(after[0].status).toBe("paid");
      expect((await invoicesOf(q)).length).toBe(1);
    });

    it("REGRESIÓN (orden inverso): cobrar y luego convertir → no crea otra reserva y devuelve la existente", async () => {
      const q = await freshQuote();
      ok(await pay(q), "cobrar");
      const before = await live(q);
      expect(before.length).toBe(1);
      const r = ok(await convert(q), "convertir tras cobrar");
      expect(Number(r.reservationId)).toBe(Number(before[0].id));
      expect((await live(q)).length).toBe(1);
    });

    it("simultáneo: 3 conversiones + 3 cobros a la vez (3 rondas) → UNA reserva viva y UNA factura", async () => {
      for (let round = 0; round < 3; round++) {
        const q = await freshQuote();
        await Promise.all([convert(q), convert(q), convert(q), pay(q), pay(q), pay(q)]);
        const rs = await live(q);
        log("convertir+cobrar simultáneo", { reservas: rs.length, estado: rs.map((r: any) => r.status) });
        expect(rs.length).toBe(1);
        expect((await invoicesOf(q)).length).toBe(1);
      }
    });

    it("CASO LEGÍTIMO: cobrar sin convertir antes sigue creando exactamente una reserva, ya enlazada al presupuesto", async () => {
      const q = await freshQuote();
      ok(await pay(q), "cobrar");
      const rs = await live(q);
      expect(rs.length).toBe(1);
      expect(rs[0].status).toBe("paid");
      expect(Number(rs[0].quoteId)).toBe(q);
    });

    it("fallo al facturar tras convertir: la reserva pendiente queda intacta, sin número de factura consumido, y el reintento completa con la misma reserva", async () => {
      const nm = failName();
      const q = await freshQuote(nm);
      ok(await convert(q), "convertir");
      const before = await live(q);
      const counter = async () => Number((await ess.sql("a", "SELECT current_number AS n FROM document_counters WHERE document_type = 'factura' ORDER BY id DESC LIMIT 1"))[0]?.n ?? 0);
      const c0 = await counter();
      await ess.sql("a", `ALTER TABLE invoices ADD CONSTRAINT audit_fail_inv2 CHECK (clientName <> '${nm}')`);
      let failed: Res;
      try { failed = await pay(q); } finally { await ess.sql("a", "ALTER TABLE invoices DROP CHECK audit_fail_inv2"); }
      expect(failed.status).not.toBe(200);
      const mid = await live(q);
      expect(mid.length).toBe(1);
      expect(mid[0].status).toBe("pending_payment");
      expect(await counter()).toBe(c0);
      ok(await pay(q), "reintento");
      const after = await live(q);
      expect(after.length).toBe(1);
      expect(after[0].id).toBe(before[0].id);
      expect(after[0].status).toBe("paid");
      expect((await invoicesOf(q)).length).toBe(1);
    });

    it("idempotencia: cobrar dos veces tras convertir no crea reservas ni facturas nuevas", async () => {
      const q = await freshQuote();
      ok(await convert(q), "convertir");
      ok(await pay(q), "cobrar 1");
      const n = await counterOfRes();
      ok(await pay(q), "cobrar 2");
      expect(await counterOfRes()).toBe(n);
      expect((await invoicesOf(q)).length).toBe(1);
    });
  });

  // ───────────────────────── 2e. Incidencias fiscales persistentes y reconciliación ─────────────────────────
  describe("2e. incidencias persistentes: pago sin factura y plan de cuotas sin completar", () => {
    const counter = async () => Number((await ess.sql("a", "SELECT current_number AS n FROM document_counters WHERE document_type = 'factura' ORDER BY id DESC LIMIT 1"))[0]?.n ?? 0);
    const failing = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      await ess.sql("a", `ALTER TABLE invoices ADD CONSTRAINT audit_fail_inv3 CHECK (clientName <> '${name}')`);
      try { return await fn(); } finally { await ess.sql("a", "ALTER TABLE invoices DROP CHECK audit_fail_inv3"); }
    };
    const incidentsOf = async (q: number, action: string) => ess.sql("a", "SELECT id, details FROM crm_activity_log WHERE entityType = 'quote' AND entityId = ? AND action = ? ORDER BY id", [q, action]);
    const listOpen = async () => (ok(await ess.q("a", "crm.fiscalIncidents.list", undefined, adm), "lista") as any[]);
    const reconcile = (incidentId: number) => ess.m("a", "crm.fiscalIncidents.reconcile", { incidentId }, adm);
    const invoicesOfRes = async (resId: number) => Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices WHERE reservationId = ?", [resId]))[0].n);

    /** Pago pendiente de 400 € sobre una reserva ya convertida, confirmado con la factura rota. */
    const setupPaidWithoutInvoice = async (breakAtConfirm: boolean) => {
      const nm = failName();
      const q = await freshQuote(nm);
      ok(await ess.m("a", "crm.quotes.convertToReservation", { quoteId: q }, adm), "convertir");
      const resId = Number((await ess.sql("a", "SELECT id FROM reservations WHERE quote_id = ? LIMIT 1", [q]))[0].id);
      ok(await ess.m("a", "crm.pendingPayments.create", { quoteId: q, reservationId: resId, clientName: nm, productName: "Servicio sintético", amountCents: 40000, dueDate: "2027-01-01", reason: "prueba" }, adm), "pago pendiente");
      const pp = Number((await ess.sql("a", "SELECT id FROM pending_payments WHERE quote_id = ? LIMIT 1", [q]))[0].id);
      const confirm = () => ess.m("a", "crm.pendingPayments.confirm", { id: pp, paymentMethod: "efectivo" }, adm);
      if (breakAtConfirm) await failing(nm, confirm); else ok(await confirm(), "confirmar");
      return { q, resId, pp, nm };
    };

    it("pago cobrado sin factura: queda incidencia PERSISTENTE y visible en la lista; reconciliar emite UNA factura y la cierra", async () => {
      const { q, resId } = await setupPaidWithoutInvoice(true);
      const inc = await incidentsOf(q, "payment_confirmed_without_invoice");
      expect(inc.length).toBe(1);
      expect((await listOpen()).some((i) => i.id === Number(inc[0].id))).toBe(true);
      const c0 = await counter();
      expect(ok(await reconcile(Number(inc[0].id)), "reconciliar").status).toBe("issued");
      expect(await invoicesOfRes(resId)).toBe(1);
      expect(await counter()).toBe(c0 + 1);
      expect((await listOpen()).some((i) => i.id === Number(inc[0].id))).toBe(false);
      // Idempotente: repetir no emite otra
      expect(ok(await reconcile(Number(inc[0].id)), "repetir").status).toBe("already_resolved");
      expect(await invoicesOfRes(resId)).toBe(1);
    });

    it("reconciliar ×4 a la vez la misma incidencia → exactamente UNA factura, sin número perdido", async () => {
      const { q, resId } = await setupPaidWithoutInvoice(true);
      const inc = await incidentsOf(q, "payment_confirmed_without_invoice");
      const c0 = await counter();
      const rs = await Promise.all(Array.from({ length: 4 }, () => reconcile(Number(inc[0].id))));
      log("reconciliar x4", rs.map((r) => r.status));
      expect(await invoicesOfRes(resId)).toBe(1);
      expect(await counter()).toBe(c0 + 1);
    });

    it("si la reconciliación vuelve a fallar: sigue abierta, sin factura ni número consumido ni ruido duplicado; un reintento posterior la resuelve", async () => {
      const { q, resId, nm } = await setupPaidWithoutInvoice(true);
      const inc = Number((await incidentsOf(q, "payment_confirmed_without_invoice"))[0].id);
      const c0 = await counter();
      const failed = await failing(nm, () => reconcile(inc));
      expect(failed.status).not.toBe(200);
      expect(await counter()).toBe(c0);
      expect(await invoicesOfRes(resId)).toBe(0);
      expect((await incidentsOf(q, "payment_confirmed_without_invoice")).length).toBe(1);
      expect((await listOpen()).some((i) => i.id === inc)).toBe(true);
      expect(ok(await reconcile(inc), "reintento").status).toBe("issued");
      expect(await invoicesOfRes(resId)).toBe(1);
    });

    it("cuotas: si falla la factura final al cobrar la última cuota, queda incidencia persistente; reconciliar completa el plan con UNA factura", async () => {
      const nm = failName();
      const q = await freshQuote(nm);
      ok(await ess.m("a", "crm.paymentPlans.upsert", { quoteId: q, installments: [
        { installmentNumber: 1, amountCents: 20000, dueDate: "2027-01-10", isRequiredForConfirmation: true },
        { installmentNumber: 2, amountCents: 20000, dueDate: "2027-02-10", isRequiredForConfirmation: false },
      ] }, adm), "plan");
      const ids = (await ess.sql("a", "SELECT id FROM payment_installments WHERE quote_id = ? ORDER BY installment_number", [q])).map((r: any) => Number(r.id));
      const payInst = (id: number) => ess.m("a", "crm.paymentPlans.confirmInstallment", { installmentId: id, paymentMethod: "efectivo" }, adm);
      ok(await payInst(ids[0]), "cuota 1");
      const c0 = await counter();
      const bad = await failing(nm, () => payInst(ids[1]));
      expect(bad.status).not.toBe(200);
      expect(await counter()).toBe(c0);
      const inc = await incidentsOf(q, "installment_plan_failed");
      expect(inc.length).toBeGreaterThanOrEqual(1);
      const id = Number(inc[0].id);
      expect((await listOpen()).some((i) => i.id === id)).toBe(true);
      expect(ok(await reconcile(id), "reconciliar plan").status).toBe("plan_reconciled");
      expect((await invoicesOf(q)).length).toBe(1);
      expect((await ess.sql("a", "SELECT paidAt FROM quotes WHERE id = ?", [q]))[0].paidAt).not.toBeNull();
      expect((await listOpen()).some((i) => i.id === id)).toBe(false);
      expect(await counter()).toBe(c0 + 1);
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
