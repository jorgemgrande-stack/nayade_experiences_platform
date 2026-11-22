/**
 * Cobros con la cuenta Stripe de cada empresa, de punta a punta con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas; datos ficticios; NINGUNA salida a Stripe (la red está bloqueada
 * por el banco de pruebas): la alta de la cuenta y la creación de la sesión de pago las cubren las pruebas unitarias con
 * la pasarela falsa; aquí se prueba lo que ocurre CUANDO LLEGA EL EVENTO FIRMADO, con la firma real del SDK:
 *
 *  A. Circuito Quantum: solicitud → inscripción → presupuesto → (vuelta del navegador: sigue pendiente) → evento
 *     firmado → presupuesto pagado con factura → la inscripción se confirma sin motivo.
 *  B. Evento repetido (mismo id o con otro id para la misma sesión): se aplica una sola vez (una factura).
 *  C. Aislamiento: un evento de la cuenta de la empresa B que dice ser de A no toca nada; la sesión de A tampoco se
 *     aplica con la cuenta de B.
 *  D. Firma inválida o ausente: 400 sin efecto. Empresa desconocida: 200 sin efecto.
 *  E. Interruptor y estado: la página pública solo ofrece Stripe con cuenta verificada y cobros encendidos; `account.updated`
 *     restringe la cuenta y apaga el interruptor.
 *  F. Administración: solo administradores; Real no se puede activar.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Stripe from "stripe";
import mysql from "mysql2/promise";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";
import { addDaysToDate } from "../shared/editionSessions";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 90_000 });

const TAG = Date.now().toString(36);
const SECRET = "whsec_" + "c".repeat(32);
const ACCT_A = "acct_1CobrosEmpresaA001";
const ACCT_B = "acct_1CobrosEmpresaB002";
const today = () => new Intl.DateTimeFormat("sv", { timeZone: "Europe/Madrid" }).format(new Date());
const PATH = "/api/stripe/connect/webhook";

describe.skipIf(!URL_)("Cobros por empresa con Stripe Connect (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let admA = "";
  let agA = "";
  let admB = "";
  let tenantA = "";
  let tenantB = "";
  let reg: mysql.Pool;
  const q = { id: 0, token: `tok${TAG}`.padEnd(40, "x"), session: "cs_test_aaa111", leadId: 0, enrollment: 0 };
  const ok = (r: { status: number; json: any }, what: string) => {
    expect(r.status, `${what}: ${JSON.stringify(r.json)}`).toBe(200);
    return data(r as any);
  };

  const event = (id: string, over: { type?: string; account?: string; tenant?: string; livemode?: boolean; object?: Record<string, unknown> } = {}) => ({
    id,
    type: over.type ?? "checkout.session.completed",
    livemode: over.livemode ?? false,
    account: over.account ?? ACCT_A,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: q.session, payment_status: "paid", amount_total: 40000, currency: "eur", payment_intent: "pi_test_aaa", metadata: { tenant_id: over.tenant ?? tenantA, quote_id: String(q.id) }, ...(over.object ?? {}) } },
  });
  const post = (host: "a" | "b", ev: unknown, o: { sign?: boolean; badSig?: boolean } = {}) => {
    const body = JSON.stringify(ev);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (o.badSig) headers["stripe-signature"] = "t=1,v1=00";
    else if (o.sign !== false) headers["stripe-signature"] = Stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
    return ess.call(host, "POST", PATH, { raw: body, headers });
  };
  const quoteRow = async () => (await ess.sql("a", "SELECT status, paidAt, invoiceNumber FROM quotes WHERE id = ?", [q.id]))[0];
  /** Foto de lo que el pago puede cambiar: presupuesto, factura, reserva, contabilidad, cliente potencial e inscripción. */
  const snap = async () => {
    const [qr] = await ess.sql("a", "SELECT status, paidAt IS NOT NULL AS paid, invoiceNumber, payment_method AS paymentMethod FROM quotes WHERE id = ?", [q.id]);
    const inv = await ess.sql("a", "SELECT status, paymentMethod, total FROM invoices WHERE quoteId = ?", [q.id]);
    const [lead] = await ess.sql("a", "SELECT status, opportunityStatus FROM leads WHERE id = ?", [q.leadId]);
    const [en] = await ess.sql("a", "SELECT status, quote_id FROM edition_enrollments WHERE id = ?", [q.enrollment]);
    const [ed] = await ess.sql("a", "SELECT reserved FROM product_editions WHERE id = (SELECT edition_id FROM edition_enrollments WHERE id = ?)", [q.enrollment]);
    const edId = (await ess.sql("a", "SELECT edition_id FROM edition_enrollments WHERE id = ?", [q.enrollment]))[0].edition_id;
    const listed = (ok(await ess.q("a", "products.editions.enrollments", { editionId: edId }, admA), "inscripciones") as any[]).find((x) => x.id === q.enrollment);
    const act = await ess.sql("a", "SELECT action FROM crm_activity_log WHERE entityType = 'quote' AND entityId = ? ORDER BY id", [q.id]);
    return {
      presupuesto: { estado: qr.status, pagado: !!qr.paid, factura: qr.invoiceNumber ? "sí" : "no", metodo: qr.paymentMethod },
      facturas: inv.map((i: any) => ({ estado: i.status, metodo: i.paymentMethod, total: Number(i.total) })),
      reservas: (await ess.sql("a", "SELECT COUNT(*) AS n FROM reservations"))[0].n,
      transacciones: (await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions"))[0].n,
      lead: { estado: lead.status, oportunidad: lead.opportunityStatus },
      inscripcion: { estado: en.status, presupuestoEnlazado: !!en.quote_id, plazasOcupadas: ed.reserved, pago: listed.payment?.label ?? null, pagada: listed.payment?.paid ?? null },
      actividad: act.map((a: any) => a.action),
    };
  };
  const invoices = async () => ess.sql("a", "SELECT id, invoiceNumber, status FROM invoices WHERE quoteId = ?", [q.id]);

  beforeAll(async () => {
    process.env.CONNECT_STRIPE_MODE = "test";
    process.env.CONNECT_STRIPE_API_KEY = "rk_test_" + "d".repeat(24);
    process.env.CONNECT_STRIPE_WEBHOOK_SECRET = SECRET;
    ess = await startEssentialApp(URL_!, "cobros");
    tenantA = ess.ids.a;
    tenantB = ess.ids.b;
    // Índice global de cuentas (registro 0018): lo escribiría el plano de control; el Core lo lee para resolver el webhook
    reg = mysql.createPool({ uri: process.env.REGISTRY_DATABASE_URL!, connectionLimit: 3 });
    for (const [acct, tid] of [[ACCT_A, tenantA], [ACCT_B, tenantB]] as const) await reg.query("INSERT INTO tenant_payment_accounts (account_id, tenant_id, provider, mode, claimed_at) VALUES (?, ?, 'stripe', 'test', ?)", [acct, tid, Date.now()]);
    admA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    admB = await ess.login("b", "admin");
    await ess.markPaid("a");
    ok(await ess.m("a", "products.createCategory", { slug: "formacion", name: "Formación" }, admA), "categoría");
    ok(await ess.m("a", "products.createLocation", { slug: "online", name: "Online" }, admA), "lugar");
    const cat = (await ess.sql("a", "SELECT id FROM categories LIMIT 1"))[0].id;
    const loc = (await ess.sql("a", "SELECT id FROM locations LIMIT 1"))[0].id;
    const slug = `paquete-cobros-${TAG}`;
    ok(await ess.m("a", "products.create", { productType: "own", categoryId: cat, locationId: loc, offerMode: "priced_request", slug, title: "Paquete Reconnect", basePrice: "400.00" }, admA), "producto");
    const exp = (await ess.sql("a", "SELECT id FROM experiences WHERE slug = ?", [slug]))[0].id;
    ok(await ess.m("a", "products.createVariant", { experienceId: exp, name: "Paquete 4 sesiones", priceModifier: "400.00", priceType: "fixed" }, admA), "modalidad");
    const variant = (await ess.sql("a", "SELECT id FROM experience_variants WHERE experienceId = ?", [exp]))[0].id;
    const d0 = addDaysToDate(today(), 7);
    const ed = ok(await ess.m("a", "products.editions.create", { experienceId: exp, form: { label: "Grupo", startsLocal: `${d0}T10:00`, endsLocal: null, timezone: "Europe/Madrid", scheduleNote: "", mode: "online", locationNote: "", capacity: 10, showAvailability: false, status: "open", priceOverride: null } }, admA), "convocatoria").id;
    const r = ok(await ess.m("a", "crm.leads.submitTestRequest", { experienceId: exp, editionId: ed, variantId: variant, seats: 1, lang: "es", name: "Ana Cobros", email: `ana.${TAG}@cobros-a.example` }, admA), "solicitud");
    q.leadId = r.leadId;
    q.enrollment = (await ess.sql("a", "SELECT id FROM edition_enrollments WHERE lead_id = ?", [q.leadId]))[0].id;
    const prep = ok(await ess.m("a", "products.editions.prepareQuote", { enrollmentId: q.enrollment }, admA), "presupuesto");
    q.id = prep.quoteId;
    // Enlace público del presupuesto (como el que se envía a la persona) y sesión de pago ya creada en la cuenta de A
    await ess.sql("a", "UPDATE quotes SET paymentLinkToken = ?, status = 'enviado' WHERE id = ?", [q.token, q.id]);
    const now = Date.now();
    await ess.sql("a", "INSERT INTO payment_accounts (provider, mode, account_id, status, charges_enabled, payouts_enabled, details_submitted, online_enabled, connected_at, verified_at, updated_at) VALUES ('stripe','test',?,'verificada',1,1,1,1,?,?,?)", [ACCT_A, now, now, now]);
    await ess.sql("b", "INSERT INTO payment_accounts (provider, mode, account_id, status, charges_enabled, payouts_enabled, details_submitted, online_enabled, connected_at, verified_at, updated_at) VALUES ('stripe','test',?,'verificada',1,1,1,1,?,?,?)", [ACCT_B, now, now, now]);
    await ess.sql("a", "INSERT INTO payment_checkouts (session_id, mode, account_id, quote_id, amount_cents, currency, status, created_at) VALUES (?,'test',?,?,40000,'eur','pending',?)", [q.session, ACCT_A, q.id, now]);
  }, 300_000);
  afterAll(async () => {
    await reg?.end();
    await ess?.close();
  });

  it("E. la página pública ofrece Stripe solo con cuenta verificada y cobros encendidos", async () => {
    let pub = ok(await ess.q("a", "crm.quotes.getByToken", { token: q.token }), "ficha pública");
    expect(pub).toMatchObject({ isPaid: false, stripeAvailable: true });
    await ess.sql("a", "UPDATE payment_accounts SET online_enabled = 0 WHERE mode='test'");
    pub = ok(await ess.q("a", "crm.quotes.getByToken", { token: q.token }), "ficha pública apagada");
    expect(pub.stripeAvailable).toBe(false);
    await ess.sql("a", "UPDATE payment_accounts SET online_enabled = 1 WHERE mode='test'");
  });

  it("A1. la vuelta del navegador deja el pago pendiente: sin evento firmado nada cambia", async () => {
    // La redirección es solo una visita a la página con ?stripe=volver: no existe ninguna ruta que marque el pago
    const pub = ok(await ess.q("a", "crm.quotes.getByToken", { token: q.token }), "ficha tras volver");
    expect(pub.isPaid).toBe(false);
    expect((await quoteRow()).paidAt).toBeNull();
    // Sin pago no se confirma la inscripción sin motivo
    const r = await ess.m("a", "products.editions.setEnrollmentStatus", { enrollmentId: q.enrollment, status: "confirmada" }, admA);
    expect(r.status).not.toBe(200);
  });

  it("D. firma inválida o ausente: 400 sin efecto; empresa desconocida: 200 sin efecto", async () => {
    expect((await post("a", event("evt_sinfirma"), { sign: false })).status).toBe(400);
    expect((await post("a", event("evt_malafirma"), { badSig: true })).status).toBe(400);
    // Cuenta que ninguna empresa tiene en el índice: 200 sin efecto (aunque el metadato nombre a una empresa real)
    expect((await post("a", event("evt_ghost", { account: "acct_1NadieLaTiene0009" }))).json).toMatchObject({ ignored: "unknown_tenant" });
    expect((await quoteRow()).paidAt).toBeNull();
    expect(await ess.sql("a", "SELECT event_id FROM payment_events")).toHaveLength(0);
  });

  it("C. aislamiento: la cuenta de B no puede pagar el presupuesto de A, ni en su nombre ni en el de A", async () => {
    // Evento de la cuenta de B que reclama ser de la empresa A
    const forged = await post("a", event("evt_forged", { account: ACCT_B }));
    expect(forged.json).toMatchObject({ outcome: "isolated" });
    // Evento de la cuenta de B que reclama ser de B pero con la sesión de A: B no tiene esa sesión
    const other = await post("b", event("evt_other", { account: ACCT_B, tenant: tenantB }));
    expect(other.json).toMatchObject({ outcome: "isolated" });
    expect((await quoteRow()).paidAt).toBeNull();
    expect((await ess.sql("a", "SELECT status FROM payment_checkouts WHERE session_id = ?", [q.session]))[0].status).toBe("pending");
    expect(await invoices()).toHaveLength(0);
  });

  it("A2. el evento firmado registra el pago, factura el presupuesto y la inscripción se confirma sin motivo", async () => {
    const before = await snap();
    const r = await post("a", event("evt_paid_1"));
    const afterEvent = await snap();
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ outcome: "applied" });
    const row = await quoteRow();
    expect(row.status).toBe("aceptado");
    expect(row.paidAt).not.toBeNull();
    expect(row.invoiceNumber).toBeTruthy();
    expect(await invoices()).toHaveLength(1);
    // El cobro de Stripe no figura como Redsys en la factura ni en el presupuesto
    expect(afterEvent.facturas).toEqual([expect.objectContaining({ metodo: "otro", total: 400 })]);
    expect(afterEvent.presupuesto.metodo).toBe("otro");
    // Antes del evento no había nada; el evento no confirma la inscripción (solo la deja pagada) y la confirmación la ocupa
    expect(before).toMatchObject({ facturas: [], reservas: 0, transacciones: 0, inscripcion: { estado: "solicitada", plazasOcupadas: 0, pagada: false } });
    expect(afterEvent).toMatchObject({ reservas: 1, transacciones: 1, lead: { estado: "convertido", oportunidad: "ganada" }, inscripcion: { estado: "solicitada", plazasOcupadas: 0, pagada: true } });
    expect(afterEvent.actividad).toContain("payment_confirmed");
    const [co] = await ess.sql("a", "SELECT status, payment_intent_id, paid_at FROM payment_checkouts WHERE session_id = ?", [q.session]);
    expect(co).toMatchObject({ status: "paid", payment_intent_id: "pi_test_aaa" });
    const [acct] = await ess.sql("a", "SELECT last_event_id, last_event_type FROM payment_accounts WHERE mode='test'");
    expect(acct).toMatchObject({ last_event_id: "evt_paid_1", last_event_type: "checkout.session.completed" });
    // La web pública ya lo ve pagado
    expect(ok(await ess.q("a", "crm.quotes.getByToken", { token: q.token }), "ficha pagada").isPaid).toBe(true);
    // La inscripción se lee como pagada y se confirma sin motivo
    const listed = (ok(await ess.q("a", "products.editions.enrollments", { editionId: (await ess.sql("a", "SELECT edition_id FROM edition_enrollments WHERE id = ?", [q.enrollment]))[0].edition_id }, admA), "inscripciones") as any[]).find((x) => x.id === q.enrollment);
    expect(listed.payment).toMatchObject({ paid: true });
    const conf = ok(await ess.m("a", "products.editions.setEnrollmentStatus", { enrollmentId: q.enrollment, status: "confirmada" }, admA), "confirmar");
    expect(conf).toMatchObject({ changed: true });
    const afterConfirm = await snap();
    expect(afterConfirm.inscripcion).toMatchObject({ estado: "confirmada", plazasOcupadas: 1, pagada: true });
    console.log("INSTANTANEA_COBRO " + JSON.stringify({ before, afterEvent, afterConfirm }));
  });

  it("B. evento repetido (mismo id, o con otro id para la misma sesión): una sola factura", async () => {
    const txBefore = (await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions"))[0].n;
    expect((await post("a", event("evt_paid_1"))).json).toMatchObject({ outcome: "duplicate" });
    expect((await post("a", event("evt_paid_2"))).json).toMatchObject({ outcome: "duplicate" });
    expect((await post("a", event("evt_paid_3", { type: "checkout.session.async_payment_succeeded" }))).json).toMatchObject({ outcome: "duplicate" });
    expect(await invoices()).toHaveLength(1);
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions"))[0].n).toBe(txBefore);
  });

  it("B2. una SEGUNDA sesión pagada sobre un presupuesto ya cobrado: sin nueva factura y con rastro «duplicate_payment»", async () => {
    await ess.sql("a", "INSERT INTO payment_checkouts (session_id, mode, account_id, quote_id, amount_cents, currency, status, created_at) VALUES ('cs_test_bbb222','test',?,?,40000,'eur','pending',?)", [ACCT_A, q.id, Date.now()]);
    const txBefore = (await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions"))[0].n;
    expect((await post("a", event("evt_dup_pay_1", { object: { id: "cs_test_bbb222", payment_intent: "pi_test_bbb" } }))).json).toMatchObject({ outcome: "duplicate_payment" });
    expect(await invoices()).toHaveLength(1); // ninguna factura nueva
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM transactions"))[0].n).toBe(txBefore);
    expect((await ess.sql("a", "SELECT status, payment_intent_id FROM payment_checkouts WHERE session_id = 'cs_test_bbb222'"))[0]).toMatchObject({ status: "paid", payment_intent_id: "pi_test_bbb" });
    expect((await ess.sql("a", "SELECT outcome FROM payment_events WHERE event_id = 'evt_dup_pay_1'"))[0].outcome).toBe("duplicate_payment");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM crm_activity_log WHERE entityType = 'quote' AND entityId = ? AND action = 'duplicate_payment_detected'", [q.id]))[0].n).toBe(1);
  });

  it("E2. account.updated restringe la cuenta y apaga el interruptor; solo cambia la empresa dueña", async () => {
    const upd = (id: string, account: string, tenant: string) => ({
      id, type: "account.updated", livemode: false, account,
      data: { object: { id: account, charges_enabled: false, payouts_enabled: false, details_submitted: true, requirements: { currently_due: ["individual.id_number"], disabled_reason: "requirements.past_due" }, metadata: { tenant_id: tenant } } },
    });
    expect((await post("a", upd("evt_acct_1", ACCT_A, tenantA))).json).toMatchObject({ outcome: "applied" });
    const [a] = await ess.sql("a", "SELECT status, online_enabled FROM payment_accounts WHERE mode='test'");
    expect(a).toMatchObject({ status: "restringida", online_enabled: 0 });
    const [b] = await ess.sql("b", "SELECT status, online_enabled FROM payment_accounts WHERE mode='test'");
    expect(b).toMatchObject({ status: "verificada", online_enabled: 1 });
  });

  it("F. administración: solo administradores; el modo Real no se puede activar", async () => {
    const st = ok(await ess.q("a", "cobros.status", undefined, admA), "estado");
    expect(st.platformReady).toBe(true);
    expect(st.modes.map((m: any) => [m.mode, m.label, m.status])).toEqual([["test", "Prueba", "restringida"], ["live", "Real", "no_conectada"]]);
    expect(JSON.stringify(st)).not.toContain(ACCT_A);
    expect(errCode(await ess.q("a", "cobros.status", undefined, agA))).toBe("FORBIDDEN");
    expect(errCode(await ess.m("a", "cobros.setOnline", { mode: "live", enabled: true }, admA))).toBe("PRECONDITION_FAILED");
    // Con la cuenta restringida no se puede encender el interruptor de Prueba
    expect(errCode(await ess.m("a", "cobros.setOnline", { mode: "test", enabled: true }, admA))).toBe("BAD_REQUEST");
    // Cada empresa ve solo lo suyo
    const stB = ok(await ess.q("b", "cobros.status", undefined, admB), "estado B");
    expect(stB.modes[0]).toMatchObject({ status: "verificada", onlineEnabled: true });
  });
});
