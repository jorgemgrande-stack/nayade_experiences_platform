/**
 * Prueba E2E de una EMPRESA NUEVA con Elephant Source Essential (opt-in, REGISTRY_TEST_DATABASE_URL).
 *
 * Escenario «Empresa Demo Elephant 01», 28 pasos sin intervención humana fuera de la API: catálogo
 * público → registro → verificación → prueba de 15 días → asistente → cliente, producto, presupuesto,
 * pedido, checkout (pasarela de PRUEBA firmada) y factura (solo en esta empresa sintética) → empleado
 * con invitación → permisos → plan y límites → vencimiento y solo lectura → contratación por el
 * orquestador con pago de PRUEBA firmado → escritura recuperada sin pérdida de datos → cancelación en
 * cascada a fin de periodo → estado final. Y «Empresa Demo Elephant 02»: registrada igual, sin acceso a
 * NINGÚN dato de la 01 por tRPC ni por REST (incluidos identificadores y la cookie de la 01).
 *
 * Sin cuentas privilegiadas para ocultar permisos: la propietaria y la empleada son usuarias reales de
 * su empresa creadas por el propio flujo; el operador solo actúa por la API del plano de control.
 * Cada paso FALLA si su operación esencial falla (ningún error se convierte en aviso).
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:ci_only@127.0.0.1:3418/registry_test \
 *     pnpm vitest run server/clienteNuevo.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { startElephantStack, data, errCode, DAY, type ElephantStack, type Res } from "./elephantStack.testkit";

// Correos de la aplicación (invitaciones, confirmaciones): a un buzón en memoria
const appMail = vi.hoisted(() => [] as Array<{ to: string | string[]; subject: string; html: string; text?: string }>);
vi.mock("./mailer", async (orig) => ({
  ...(await orig<typeof import("./mailer")>()),
  sendEmail: async (p: { to: string | string[]; subject: string; html: string; text?: string }) => {
    appMail.push(p);
    return true;
  },
}));

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const YEAR = new Date().getFullYear();
// Clave de comercio FICTICIA de la pasarela en modo pruebas (generada en cada ejecución)
const REDSYS_KEY = crypto.randomBytes(24).toString("base64");

/** Notificación de la pasarela firmada como lo haría Redsys (3DES del pedido + HMAC-SHA256). */
function signedNotification(d: Record<string, string>) {
  const params = Buffer.from(JSON.stringify(d)).toString("base64");
  const key = Buffer.from(REDSYS_KEY, "base64").subarray(0, 24);
  const padded = Buffer.alloc(Math.ceil(Buffer.byteLength(d.Ds_Order) / 8) * 8, 0);
  Buffer.from(d.Ds_Order).copy(padded);
  const c = crypto.createCipheriv("des-ede3-cbc", key, Buffer.alloc(8, 0));
  c.setAutoPadding(false);
  const derived = Buffer.concat([c.update(padded), c.final()]);
  const sig = crypto.createHmac("sha256", derived).update(params).digest("base64");
  return new URLSearchParams({ Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: params, Ds_Signature: sig }).toString();
}

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 150));
    v = await fn();
  }
  return v;
}

/** Evidencia legible por paso (se imprime al final). */
const evidence: Array<{ step: string; result: string; detail: string }> = [];
const note = (step: string, detail: string) => evidence.push({ step, result: "OK", detail });

describe.skipIf(!URL_)("cliente nuevo de punta a punta: Empresa Demo Elephant 01 y 02 (MySQL real)", () => {
  let s: ElephantStack;
  let run = "";
  const one = { trialId: 0, tenantId: "", owner: "", pass: "", cookie: "", empEmail: "", empPass: "", empCookie: "", clientId: 0, productId: 0, productSlug: "", quoteId: 0, quoteNumber: "", orderReservationId: 0, checkoutReservationId: 0, merchantOrder: "", invoiceId: 0, invoiceNumber: "", orderId: 0, subId: 0, payment: null as any };
  const two = { trialId: 0, tenantId: "", owner: "", pass: "", cookie: "" };
  const TAX_ID = "B99000001";
  const COMPANY_01 = "Empresa Demo Elephant 01";
  const COMPANY_02 = "Empresa Demo Elephant 02";
  // Marcas inconfundibles de los datos de la 01 (no deben aparecer nunca en la 02)
  const MARKERS = [TAX_ID, "Cliente Demo Uno", "cliente-uno@demo-01.example", "servicio-demo-01", "Servicio Demo 01", "Presupuesto Demo 01"];

  const db = async <T = any>(tenantId: string, sql: string, params: unknown[] = []) => {
    const c = await s.tenantConn(tenantId);
    try {
      return (await c.query<mysql.RowDataPacket[]>(sql, params))[0] as T[];
    } finally {
      await c.end();
    }
  };
  const ok200 = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.raw.slice(0, 400)}`);
    return data(r);
  };
  const counts = async (tenantId: string) => {
    const [n] = await db(tenantId, "SELECT (SELECT COUNT(*) FROM clients) AS clients, (SELECT COUNT(*) FROM experiences) AS products, (SELECT COUNT(*) FROM quotes) AS quotes, (SELECT COUNT(*) FROM reservations) AS reservations, (SELECT COUNT(*) FROM invoices) AS invoices, (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM leads) AS leads");
    return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Number(v)]));
  };
  /** Registro + verificación por la API pública y acceso de la propietaria en SU host. */
  async function signUp(company: string, email: string, password: string) {
    const r = await s.cp("POST", "/public/trial", { body: { email, companyName: company, idempotencyKey: crypto.randomBytes(12).toString("hex") } });
    expect(r.status).toBe(202);
    expect(r.raw).not.toMatch(/token/i);
    const link = s.verificationLink(email);
    const v = await s.cp("POST", "/public/trial/verify", { body: link });
    if (v.status !== 200) throw new Error(`verificación: ${v.status} ${v.raw}`);
    expect(v.json.trial?.state ?? v.json.state).toBe("active");
    const tenantId = String(v.json.domain).split(".")[0];
    s.tenants.push(tenantId);
    return { trialId: link.id, tenantId, verify: v };
  }
  async function acceptInvite(tenantId: string, token: string, email: string, password: string) {
    ok200(await s.m(tenantId, "public.setPassword", { token, password }), "establecer contraseña");
    const login = await s.app(tenantId, "POST", "/api/auth/login", { body: { email, password } });
    expect(login.status).toBe(200);
    expect(login.cookie).toBeTruthy();
    return login.cookie!;
  }

  beforeAll(async () => {
    s = await startElephantStack(URL_!, { label: "e2e" });
    run = s.run;
    one.owner = `propietaria-${run}@demo-elephant-01.example`;
    one.pass = `clave-${run}-propietaria-01`;
    one.empEmail = `empleada-${run}@demo-elephant-01.example`;
    one.empPass = `clave-${run}-empleada-01`;
    two.owner = `propietario-${run}@demo-elephant-02.example`;
    two.pass = `clave-${run}-propietario-02`;
  }, 180_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(["", "EVIDENCIA E2E (cliente nuevo):", ...evidence.map((e) => `  ${e.result}  ${e.step} — ${e.detail}`)].join("\n"));
    await s?.close();
  });

  // ── Empresa Demo Elephant 01 ──────────────────────────────────────────────

  it("pasos 1–4: catálogo público — Essential publicado a 29 €/mes y 279 €/año (sitio y cotizador)", async () => {
    const site = await s.cp("GET", "/public/site");
    expect(site.status).toBe(200);
    expect(site.raw).not.toMatch(/costCents|marginNote|internal/);
    const ess = site.json.catalog.products.find((p: any) => p.key === "essential");
    expect(ess).toBeTruthy();
    const monthly = ess.prices.find((p: any) => p.kind === "monthly");
    const yearly = ess.prices.find((p: any) => p.kind === "yearly");
    expect({ monthly: monthly?.amountCents, yearly: yearly?.amountCents, currency: monthly?.currency }).toEqual({ monthly: 2900, yearly: 27900, currency: "EUR" });
    const qm = await s.cp("POST", "/public/site/quote", { body: { plan: "essential", interval: "month" } });
    expect(qm.status).toBe(200);
    expect(qm.json).toMatchObject({ ok: true, plan: { key: "essential", interval: "month" } });
    expect(qm.json.totals.monthlyCents).toBe(2900);
    const qy = await s.cp("POST", "/public/site/quote", { body: { plan: "essential", interval: "year" } });
    expect(qy.status).toBe(200);
    expect(qy.json.totals.yearlyCents).toBe(27900);
    expect(qy.json.capabilities.length).toBeGreaterThanOrEqual(29);
    note("1–4 catálogo público", `essential ${monthly.amountCents / 100} €/mes, ${yearly.amountCents / 100} €/año; cotizador ${qm.json.totals.monthlyCents} / ${qy.json.totals.yearlyCents} céntimos`);
  });

  it("pasos 5–7: registro, correo de verificación (buzón en memoria) y verificación; un token falso se rechaza", async () => {
    const r = await s.cp("POST", "/public/trial", { body: { email: one.owner, companyName: COMPANY_01, idempotencyKey: crypto.randomBytes(12).toString("hex") } });
    expect(r.status).toBe(202);
    expect(r.raw).not.toMatch(/token/i);
    const link = s.verificationLink(one.owner);
    one.trialId = link.id;
    expect((await s.cp("POST", "/public/trial/verify", { body: { id: link.id, token: "x".repeat(43) } })).status).toBe(403);
    const v = await s.cp("POST", "/public/trial/verify", { body: link });
    expect(v.status).toBe(200);
    one.tenantId = String(v.json.domain).split(".")[0];
    s.tenants.push(one.tenantId);
    expect(v.json.domain).toBe(s.hostOf(one.tenantId));
    note("5–7 registro y verificación", `prueba #${one.trialId}, plataforma ${v.json.domain}; token falso → 403`);
  }, 240_000);

  it("paso 8: empresa nueva sin datos heredados y una sola usuaria (la propietaria, administradora); empresa en el CRM", async () => {
    const [u] = await Promise.all([db(one.tenantId, "SELECT email, role FROM users")]);
    expect(u).toEqual([{ email: one.owner, role: "admin" }]);
    const c = await counts(one.tenantId);
    expect(c).toEqual({ clients: 0, products: 0, quotes: 0, reservations: 0, invoices: 0, users: 1, leads: 0 });
    const [cos] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT name FROM crm_companies WHERE tenant_id = ?", [one.tenantId]);
    expect(cos.map((x) => x.name)).toEqual([COMPANY_01]);
    note("8 empresa y usuaria", `BD propia vacía ${JSON.stringify(c)}; empresa «${COMPANY_01}» en el CRM`);
  });

  it("paso 9: prueba de 15 días — licencias Essential que caducan al final; la propietaria entra en SU host", async () => {
    const [g] = await s.regPool.query<mysql.RowDataPacket[]>("SELECT capability_id, status, valid_until FROM tenant_capabilities WHERE tenant_id = ?", [one.tenantId]);
    expect(g.length).toBeGreaterThanOrEqual(29);
    expect(g.every((x) => x.status === "active" && Number(x.valid_until) === s.clock.now + 15 * DAY)).toBe(true);
    const [sub] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT s.id, s.status FROM subscriptions s JOIN crm_companies c ON c.id = s.company_id WHERE c.tenant_id = ?", [one.tenantId]);
    expect(sub.map((x) => x.status)).toEqual(["trialing"]);
    one.subId = Number(sub[0].id);
    const link = s.welcomeLink(one.owner)!;
    expect(link.host).toBe(s.hostOf(one.tenantId));
    one.cookie = await acceptInvite(one.tenantId, link.token, one.owner, one.pass);
    expect(data(await s.q(one.tenantId, "auth.me", undefined, one.cookie))).toMatchObject({ email: one.owner, role: "admin" });
    const st = ok200(await s.q(one.tenantId, "setupWizard.status", undefined, one.cookie), "setupWizard.status");
    expect(st.licence).toMatchObject({ plan: "essential", userLimit: 3, daysLeft: 15, readOnly: false });
    note("9 prueba de 15 días", `${g.length} licencias activas hasta +15 días; suscripción #${one.subId} en prueba; login en ${s.hostOf(one.tenantId)}`);
  });

  it("paso 10: asistente de primeros pasos — empresa y actividad guardadas", async () => {
    const company = { tradeName: COMPANY_01, legalName: `${COMPANY_01}, S.L.`, taxId: TAX_ID, address: "Calle Demo 1", postalCode: "28001", city: "Madrid", province: "Madrid", country: "ES", currency: "EUR", timezone: "Europe/Madrid" };
    expect((await s.m(one.tenantId, "setupWizard.saveCompany", { ...company, tradeName: "" }, one.cookie)).status).toBe(400);
    ok200(await s.m(one.tenantId, "setupWizard.saveCompany", company, one.cookie), "saveCompany");
    ok200(await s.m(one.tenantId, "setupWizard.saveActivity", { activity: "servicios" }, one.cookie), "saveActivity");
    const st = data(await s.q(one.tenantId, "setupWizard.status", undefined, one.cookie));
    expect(st.company).toMatchObject({ tradeName: COMPANY_01, taxId: TAX_ID, currency: "EUR" });
    expect(st.activity).toBe("servicios");
    expect(st.nextStep).toBe("brand");
    // Paso «Marca»: la misma marca alimenta su web y su pantalla de acceso
    ok200(await s.m(one.tenantId, "integrations.themeSave", { values: { theme_primary_color: "#0b3d91", login_welcome_title: `Hola, equipo de ${COMPANY_01}` } }, one.cookie), "themeSave");
    ok200(await s.m(one.tenantId, "setupWizard.setStep", { step: "brand", status: "done" }, one.cookie), "setStep brand");
    const theme = data(await s.q(one.tenantId, "public.getTheme"));
    expect(theme.primaryColor).toBe("#0b3d91");
    expect(theme.login.title).toBe(`Hola, equipo de ${COMPANY_01}`);
    const after = data(await s.q(one.tenantId, "setupWizard.status", undefined, one.cookie));
    expect(after.nextStep).toBe("client");
    note("10 asistente", `empresa, actividad y marca guardadas (acceso con su color y titular); siguiente paso «${after.nextStep}» (los pasos 11–17 completan el resto)`);
  });

  it("paso 11: crear cliente", async () => {
    ok200(await s.m(one.tenantId, "crm.clients.create", { name: "Cliente Demo Uno", email: "cliente-uno@demo-01.example" }, one.cookie), "crm.clients.create");
    const list = ok200(await s.q(one.tenantId, "crm.clients.list", { limit: 10, offset: 0 }, one.cookie), "crm.clients.list");
    expect(list.total).toBe(1);
    one.clientId = Number((await db(one.tenantId, "SELECT id FROM clients WHERE email = 'cliente-uno@demo-01.example'"))[0].id);
    ok200(await s.m(one.tenantId, "setupWizard.setStep", { step: "client", status: "done" }, one.cookie), "setStep client");
    note("11 cliente", `cliente #${one.clientId}`);
  });

  it("paso 12: crear producto (categoría, ubicación, precio e IVA)", async () => {
    const cat = ok200(await s.m(one.tenantId, "products.createCategory", { slug: "servicios", name: "Servicios" }, one.cookie), "createCategory");
    const loc = ok200(await s.m(one.tenantId, "products.createLocation", { slug: "sede", name: "Sede" }, one.cookie), "createLocation");
    one.productSlug = "servicio-demo-01";
    ok200(await s.m(one.tenantId, "products.create", { slug: one.productSlug, title: "Servicio Demo 01", categoryId: cat.id, locationId: loc.id, basePrice: "50.00", taxRate: "21", pricingType: "per_unit" }, one.cookie), "products.create");
    const [p] = await db(one.tenantId, "SELECT id, basePrice, taxRate FROM experiences WHERE slug = ?", [one.productSlug]);
    one.productId = Number(p.id);
    expect(Number(p.basePrice)).toBe(50);
    ok200(await s.m(one.tenantId, "setupWizard.setStep", { step: "product", status: "done" }, one.cookie), "setStep product");
    note("12 producto", `producto #${one.productId} a 50 € con IVA 21 %`);
  });

  it("paso 13: crear presupuesto (sin enviar correo al cliente)", async () => {
    const r = await s.m(one.tenantId, "crm.quotes.createDirect", { clientName: "Cliente Demo Uno", clientEmail: "cliente-uno@demo-01.example", title: "Presupuesto Demo 01", items: [{ description: "Servicio Demo 01", quantity: 2, unitPrice: 50, total: 100, taxRate: 21, productId: one.productId }], subtotal: 100, taxRate: 21, total: 121, pricesIncludeTax: false, sendNow: false }, one.cookie);
    const out = ok200(r, "crm.quotes.createDirect");
    expect(out).toMatchObject({ success: true, sent: false });
    one.quoteId = Number(out.quoteId);
    const q = ok200(await s.q(one.tenantId, "crm.quotes.get", { id: one.quoteId }, one.cookie), "crm.quotes.get");
    one.quoteNumber = String(q.quote?.quoteNumber ?? q.quoteNumber);
    expect(appMail.some((x) => x.to === "cliente-uno@demo-01.example")).toBe(false);
    ok200(await s.m(one.tenantId, "setupWizard.setStep", { step: "operation", status: "done" }, one.cookie), "setStep operation");
    note("13 presupuesto", `presupuesto #${one.quoteId} (${one.quoteNumber}) de 121 €`);
  });

  it("paso 14: convertir el presupuesto en pedido (reserva confirmada, pago pendiente)", async () => {
    const out = ok200(await s.m(one.tenantId, "crm.quotes.convertToReservation", { quoteId: one.quoteId }, one.cookie), "convertToReservation");
    one.orderReservationId = Number(out.reservationId);
    const [r] = await db(one.tenantId, "SELECT status, status_reservation AS statusReservation, quote_id AS quoteId, amount_total AS amountTotal FROM reservations WHERE id = ?", [one.orderReservationId]);
    expect(r).toMatchObject({ status: "pending_payment", statusReservation: "CONFIRMADA", quoteId: one.quoteId, amountTotal: 12100 });
    expect((await db(one.tenantId, "SELECT status FROM quotes WHERE id = ?", [one.quoteId]))[0].status).toBe("aceptado");
    // Volver a convertir no duplica el pedido
    await s.m(one.tenantId, "crm.quotes.convertToReservation", { quoteId: one.quoteId }, one.cookie);
    expect(Number((await db(one.tenantId, "SELECT COUNT(*) AS n FROM reservations WHERE quote_id = ?", [one.quoteId]))[0].n)).toBe(1);
    note("14 pedido", `pedido (reserva) #${one.orderReservationId} de 121,00 € desde el presupuesto`);
  });

  it("paso 15: checkout sin dinero real — pasarela en modo PRUEBAS con cuenta ficticia y notificación firmada", async () => {
    // Sin pasarela configurada se rechaza sin dejar pre-reservas
    const input = { productId: one.productId, bookingDate: "2030-06-01", people: 1, customerName: "Cliente Demo Uno", customerEmail: "cliente-uno@demo-01.example", origin: `https://${s.hostOf(one.tenantId)}` };
    expect(errCode(await s.m(one.tenantId, "reservations.createAndPay", input))).toBe("PRECONDITION_FAILED");
    ok200(await s.m(one.tenantId, "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: REDSYS_KEY } }, one.cookie), "integrations.save");
    const out = ok200(await s.m(one.tenantId, "reservations.createAndPay", input), "createAndPay");
    expect(out.redsysForm.url).toContain("sis-t.redsys.es"); // entorno de PRUEBAS
    expect(out.amountCents).toBe(5000); // precio del servidor, no del cliente
    one.merchantOrder = out.merchantOrder;
    const bad = await s.app(one.tenantId, "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: out.merchantOrder, Ds_Response: "0000", Ds_Amount: "1" }).replace(/Ds_Signature=[^&]+/, "Ds_Signature=AAAA"), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(bad.raw).not.toBe("OK");
    const ipn = await s.app(one.tenantId, "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: out.merchantOrder, Ds_Response: "0000", Ds_Amount: "5000", Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(ipn.raw).toBe("OK");
    const paid = await waitFor(() => db(one.tenantId, "SELECT id, status FROM reservations WHERE merchant_order = ?", [out.merchantOrder]), (rows) => rows[0]?.status === "paid");
    expect(paid[0].status).toBe("paid");
    one.checkoutReservationId = Number(paid[0].id);
    note("15 checkout", `pedido web ${out.merchantOrder} 50,00 € pagado con notificación firmada de PRUEBAS (firma falsa rechazada)`);
  });

  it("paso 16: documento fiscal — factura con la numeración y la identidad fiscal de ESTA empresa sintética", async () => {
    const inv = await waitFor(() => db(one.tenantId, "SELECT id, invoiceNumber, total, status FROM invoices WHERE reservationId = ?", [one.checkoutReservationId]), (rows) => rows.length > 0);
    expect(inv).toHaveLength(1);
    one.invoiceId = Number(inv[0].id);
    one.invoiceNumber = inv[0].invoiceNumber;
    expect(one.invoiceNumber).toBe(`FAC-${YEAR}-0001`);
    expect(Number(inv[0].total)).toBe(50);
    const list = ok200(await s.q(one.tenantId, "crm.invoices.listAll", {}, one.cookie), "crm.invoices.listAll");
    expect(list.total).toBe(1);
    const prev = await s.app(one.tenantId, "GET", `/api/invoices/preview?n=${encodeURIComponent(one.invoiceNumber)}`, { cookie: one.cookie });
    expect(prev.status).toBe(200);
    expect(prev.raw).toContain(TAX_ID);
    expect(prev.raw).not.toMatch(/n[aá]yade|skicenter|B26987875/i);
    note("16 factura", `${one.invoiceNumber} de 50,00 € con NIF ${TAX_ID} de la empresa sintética`);
  });

  it("paso 17: empleada (rol agente) con invitación por correo y activación de su acceso; asistente completo", async () => {
    ok200(await s.m(one.tenantId, "admin.createUser", { name: "Empleada Demo", email: one.empEmail, role: "agente" }, one.cookie), "admin.createUser");
    const mail = appMail.filter((x) => x.to === one.empEmail).at(-1);
    expect(mail).toBeTruthy();
    const link = new URL(mail!.html.match(/https?:\/\/[^"'\s<]+establecer-contrasena\?token=[^"'\s<&]+/)![0]);
    expect(link.host).toBe(s.hostOf(one.tenantId));
    // Antes de activar, no puede entrar
    expect((await s.app(one.tenantId, "POST", "/api/auth/login", { body: { email: one.empEmail, password: one.empPass } })).status).not.toBe(200);
    one.empCookie = await acceptInvite(one.tenantId, link.searchParams.get("token")!, one.empEmail, one.empPass);
    expect(data(await s.q(one.tenantId, "auth.me", undefined, one.empCookie))).toMatchObject({ email: one.empEmail, role: "agente" });
    ok200(await s.m(one.tenantId, "setupWizard.setStep", { step: "users", status: "done" }, one.cookie), "setStep users");
    ok200(await s.m(one.tenantId, "setupWizard.setStep", { step: "finish", status: "done" }, one.cookie), "setStep finish");
    const st = data(await s.q(one.tenantId, "setupWizard.status", undefined, one.cookie));
    // En marcha; el porcentaje refleja los pasos opcionales que quedan (web y comunicaciones), sin inventar un 100 %
    expect(st.progress.completedAt).not.toBeNull();
    expect(st.plan.steps.find((x: { id: string }) => x.id === "finish").status).toBe("done");
    note("17 empleada", `invitación en ${link.host}, contraseña definida y sesión como agente; asistente al ${st.percent} %`);
  });

  it("paso 18: permisos de la empleada — opera el CRM; no administra usuarios ni configuración", async () => {
    const e = one.empCookie;
    expect(ok200(await s.q(one.tenantId, "crm.clients.list", { limit: 10, offset: 0 }, e), "agente clients.list").total).toBe(1);
    ok200(await s.m(one.tenantId, "crm.clients.create", { name: "Cliente de la Empleada", email: "cliente-empleada@demo-01.example" }, e), "agente clients.create");
    expect(ok200(await s.q(one.tenantId, "crm.quotes.list", {}, e), "agente quotes.list")).toBeTruthy();
    const denied: Array<[string, "q" | "m", unknown]> = [
      ["admin.getUsers", "q", undefined],
      ["admin.createUser", "m", { name: "Intruso", email: `intruso-${run}@demo-elephant-01.example`, role: "admin" }],
      ["config.updateSystemSetting", "m", { key: "site_legal_name", value: "Cambio no autorizado" }],
      ["setupWizard.saveActivity", "m", { activity: "comercio" }],
      ["setupWizard.seats", "q", undefined],
      ["integrations.save", "m", { provider: "redsys", values: { environment: "test", merchantCode: "1", merchantTerminal: "1", merchantKey: REDSYS_KEY } }],
      ["products.createCategory", "m", { slug: "no", name: "No" }],
    ];
    for (const [proc, kind, input] of denied) {
      const r = kind === "q" ? await s.q(one.tenantId, proc, input, e) : await s.m(one.tenantId, proc, input, e);
      expect([proc, r.status, errCode(r)]).toEqual([proc, 403, "FORBIDDEN"]);
    }
    expect((await db(one.tenantId, "SELECT COUNT(*) AS n FROM users"))[0].n).toBe(2);
    note("18 permisos", `agente: CRM sí; ${denied.length} operaciones de administración → 403 FORBIDDEN`);
  });

  it("pasos 19–20: plan y límites — subscription.overview y setupWizard.seats", async () => {
    const ov = ok200(await s.q(one.tenantId, "subscription.overview", undefined, one.cookie), "subscription.overview");
    expect(ov).toMatchObject({ mode: "multi", licensing: "capabilities", plan: { key: "essential" }, state: "trial" });
    expect(ov.trial.daysLeft).toBe(15);
    expect(ov.limits.find((l: any) => l.metric === "users")).toMatchObject({ included: 3, used: 2 });
    // La empleada también ve el estado de su suscripción (sin administrarla)
    expect((await s.q(one.tenantId, "subscription.overview", undefined, one.empCookie)).status).toBe(200);
    const seats = ok200(await s.q(one.tenantId, "setupWizard.seats", undefined, one.cookie), "setupWizard.seats");
    expect(seats).toEqual({ used: 2, limit: 3, available: 1, plan: "essential" });
    note("19–20 plan y límites", `plan ${ov.plan.key}, estado ${ov.state}, ${ov.trial.daysLeft} días; usuarios ${seats.used}/${seats.limit}`);
  });

  // ── Empresa Demo Elephant 02: aislamiento total respecto a la 01 ───────────

  it("02 · registro igual que la 01 (registro, verificación, propietaria) y empresa vacía", async () => {
    const r = await signUp(COMPANY_02, two.owner, two.pass);
    two.trialId = r.trialId;
    two.tenantId = r.tenantId;
    expect(two.tenantId).not.toBe(one.tenantId);
    two.cookie = await acceptInvite(two.tenantId, s.welcomeLink(two.owner)!.token, two.owner, two.pass);
    expect(await counts(two.tenantId)).toEqual({ clients: 0, products: 0, quotes: 0, reservations: 0, invoices: 0, users: 1, leads: 0 });
    note("02 registro", `plataforma ${s.hostOf(two.tenantId)} distinta y vacía`);
  }, 240_000);

  it("02 · por tRPC no ve NINGÚN dato de la 01 (listados e identificadores de la 01)", async () => {
    const c = two.cookie;
    const t = two.tenantId;
    const seen: Res[] = [];
    const get = async (proc: string, input: unknown) => {
      const r = await s.q(t, proc, input, c);
      seen.push(r);
      return r;
    };
    expect(ok200(await get("crm.clients.list", { limit: 50, offset: 0 }), "clients.list").total).toBe(0);
    expect(errCode(await get("crm.clients.get", { id: one.clientId }))).toBe("NOT_FOUND");
    expect(ok200(await get("products.getAll", undefined), "products.getAll")).toEqual([]);
    expect(JSON.stringify(data(await get("public.getExperiences", {})))).not.toContain(one.productSlug);
    expect(ok200(await get("crm.quotes.list", {}), "quotes.list").total ?? 0).toBe(0);
    expect(errCode(await get("crm.quotes.get", { id: one.quoteId }))).toBe("NOT_FOUND");
    expect(ok200(await get("crm.reservations.list", {}), "reservations.list").total).toBe(0);
    expect(errCode(await get("crm.reservations.get", { id: one.orderReservationId }))).toBe("NOT_FOUND");
    expect(errCode(await get("crm.reservations.get", { id: one.checkoutReservationId }))).toBe("NOT_FOUND");
    expect(ok200(await get("crm.invoices.listAll", {}), "invoices.listAll").total).toBe(0);
    expect(errCode(await get("crm.invoices.get", { id: one.invoiceId }))).toBe("NOT_FOUND");
    const users = ok200(await get("admin.getUsers", undefined), "admin.getUsers") as Array<{ email: string }>;
    expect(users.map((u) => u.email)).toEqual([two.owner]);
    const settings = ok200(await get("config.listSystemSettings", undefined), "listSystemSettings");
    const st = ok200(await get("setupWizard.status", undefined), "setupWizard.status");
    expect(st.company.taxId).toBe("");
    expect(st.seats.used).toBe(1);
    const ov = ok200(await get("subscription.overview", undefined), "subscription.overview");
    expect(ov.limits.find((l: any) => l.metric === "users").used).toBe(1);
    expect(ok200(await get("integrations.list", undefined), "integrations.list") ?? []).toBeTruthy();
    for (const r of seen) for (const mk of MARKERS) expect([r.raw.includes(mk), mk]).toEqual([false, mk]);
    expect(JSON.stringify(settings)).not.toContain(TAX_ID);
    note("02 aislamiento tRPC", `${seen.length} consultas: listados vacíos, ids de la 01 → NOT_FOUND, ninguna marca de la 01 en las respuestas`);
  });

  it("02 · por REST y con la cookie de la 01: sin acceso cruzado", async () => {
    // Factura de la 01 pedida en el host de la 02
    const prev = await s.app(two.tenantId, "GET", `/api/invoices/preview?n=${encodeURIComponent(one.invoiceNumber)}`, { cookie: two.cookie });
    expect(prev.status).not.toBe(200);
    expect(prev.raw).not.toContain(TAX_ID);
    // Cookie de la 01 en el host de la 02 (y al revés): sin sesión
    for (const [tenant, cookie] of [[two.tenantId, one.cookie], [two.tenantId, one.empCookie], [one.tenantId, two.cookie]] as const) {
      expect((await s.q(tenant, "auth.me", undefined, cookie)).json?.result?.data?.json ?? null).toBeNull();
      expect((await s.q(tenant, "crm.clients.list", { limit: 10, offset: 0 }, cookie)).status).toBe(401);
      expect((await s.app(tenant, "GET", `/api/invoices/preview?n=${encodeURIComponent(one.invoiceNumber)}`, { cookie })).status).not.toBe(200);
    }
    // Credenciales de la 01 en el host de la 02
    expect((await s.app(two.tenantId, "POST", "/api/auth/login", { body: { email: one.owner, password: one.pass } })).status).toBe(401);
    // Notificación de pago de la 01 enviada al host de la 02 (otra empresa, otra clave): rechazada
    const cross = await s.app(two.tenantId, "POST", "/api/redsys/notification", { raw: signedNotification({ Ds_Order: one.merchantOrder, Ds_Response: "0000", Ds_Amount: "5000" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(cross.raw).not.toBe("OK");
    expect(await counts(two.tenantId)).toEqual({ clients: 0, products: 0, quotes: 0, reservations: 0, invoices: 0, users: 1, leads: 0 });
    // Licencias: cada empresa solo tiene las suyas en el registro
    const [lic] = await s.regPool.query<mysql.RowDataPacket[]>("SELECT tenant_id, COUNT(*) AS n FROM tenant_capabilities WHERE tenant_id IN (?, ?) GROUP BY tenant_id", [one.tenantId, two.tenantId]);
    expect(lic).toHaveLength(2);
    note("02 aislamiento REST", "vista de factura, sesión, login y notificación de pago de la 01 rechazados en el host de la 02");
  });

  // ── Empresa Demo Elephant 01: vencimiento, contratación y cancelación ─────

  let before: Record<string, number> = {};
  it("paso 21: simular el vencimiento de la prueba (día 16)", async () => {
    before = await counts(one.tenantId);
    s.clock.now += 16 * DAY;
    const r = await s.cp("POST", `/trials/${one.trialId}/expire`, { token: s.adminToken });
    expect(r.status).toBe(200);
    expect(r.json.trial.state).toBe("expired");
    note("21 vencimiento", "reloj +16 días; prueba marcada «expired» por la API del operador");
  });

  it("paso 22: solo lectura — lecturas sí, mutaciones 403 (licencia caducada) y datos intactos", async () => {
    const reads: Array<[string, unknown]> = [
      ["crm.clients.list", { limit: 10, offset: 0 }],
      ["crm.quotes.list", {}],
      ["crm.reservations.list", {}],
      ["crm.invoices.listAll", {}],
      ["products.getAll", undefined],
    ];
    for (const [proc, input] of reads) expect([proc, (await s.q(one.tenantId, proc, input, one.cookie)).status]).toEqual([proc, 200]);
    const st = data(await s.q(one.tenantId, "setupWizard.status", undefined, one.cookie));
    expect(st.licence).toMatchObject({ readOnly: true, daysLeft: 0 });
    const ov = ok200(await s.q(one.tenantId, "subscription.overview", undefined, one.cookie), "overview");
    expect(ov.state).toBe("trial_expired");
    const writes: Array<[string, unknown, string]> = [
      ["crm.clients.create", { name: "No debe crearse", email: "no@demo-01.example" }, one.cookie],
      ["crm.quotes.createDirect", { clientName: "X", clientEmail: "x@demo-01.example", title: "X", items: [{ description: "X", quantity: 1, unitPrice: 1, total: 1 }], subtotal: 1, total: 1, sendNow: false }, one.empCookie],
      ["products.createCategory", { slug: "bloqueada", name: "Bloqueada" }, one.cookie],
      ["admin.createUser", { name: "Bloqueada", email: `bloqueada-${run}@demo-elephant-01.example`, role: "agente" }, one.cookie],
      ["setupWizard.saveActivity", { activity: "comercio" }, one.cookie],
    ];
    for (const [proc, input, cookie] of writes) {
      const r = await s.m(one.tenantId, proc, input, cookie);
      expect([proc, r.status, r.json?.error?.json?.data?.status]).toEqual([proc, 403, "expired"]);
    }
    expect(await counts(one.tenantId)).toEqual(before);
    note("22 solo lectura", `${reads.length} lecturas 200; ${writes.length} mutaciones 403 «expired»; recuentos intactos ${JSON.stringify(before)}`);
  });

  it("paso 23: contratación por el orquestador (/cp/v1/orders) — cotiza con el catálogo y firma; aún sin activar", async () => {
    const r = await s.cp("POST", "/orders", { token: s.adminToken, body: { idempotencyKey: crypto.randomBytes(12).toString("hex"), trialId: one.trialId, request: { plan: "essential", interval: "month", items: [] } } });
    expect(r.status).toBe(201);
    expect(r.json.order).toMatchObject({ kind: "trial_conversion", state: "quoted", tenantId: one.tenantId, subscriptionId: one.subId });
    one.orderId = r.json.order.id;
    // 29 € + IVA (21 %) el primer mes
    expect(r.json.order.quote.firstPeriodCents).toBe(2900 + Math.round(2900 * 0.21));
    const acc = await s.cp("POST", `/orders/${one.orderId}/accept`, { token: s.adminToken, body: { signatureRef: `aceptacion-web-${run}`, approvalReason: "Alta autoservicio Essential (prueba E2E)" } });
    expect(acc.status).toBe(202);
    expect(acc.json.order.state).toBe("contracted");
    expect((await s.m(one.tenantId, "crm.clients.create", { name: "Aún no", email: "aun-no@demo-01.example" }, one.cookie)).status).toBe(403);
    note("23 contratación", `pedido #${one.orderId} trial_conversion cotizado en ${r.json.order.quote.firstPeriodCents} céntimos y firmado; app sigue en solo lectura`);
  });

  it("paso 24: activación de la licencia con un evento de pago de PRUEBA válido y firmado (los inválidos no activan nada)", async () => {
    const p = await s.cp("POST", `/orders/${one.orderId}/payments`, { token: s.adminToken });
    expect(p.status).toBe(201);
    one.payment = p.json.payment;
    expect(one.payment).toMatchObject({ status: "pending", mode: "test", provider: "simulated" });
    const ev = (over: Record<string, unknown> = {}) => JSON.stringify({ id: `evt_e2e_${crypto.randomBytes(6).toString("hex")}`, type: "payment.succeeded", paymentKey: one.payment.idempotencyKey, providerRef: one.payment.providerRef, amountCents: one.payment.amountCents, currency: one.payment.currency, livemode: false, ...over });
    const hook = (body: string, sig: string) => s.request(s.cpPort, "POST", "/cp/v1/payments/test/webhook", { raw: body, headers: { "content-type": "application/json", "x-test-signature": sig } });
    const forged = ev();
    expect((await hook(forged, s.signPayment(forged).replace(/v1=[0-9a-f]+/, `v1=${"0".repeat(64)}`))).status).toBe(400);
    const live = ev({ livemode: true });
    expect((await hook(live, s.signPayment(live))).status).toBe(400);
    expect((await s.m(one.tenantId, "crm.clients.create", { name: "Aún no", email: "aun-no@demo-01.example" }, one.cookie)).status).toBe(403);
    const good = ev();
    const r = await hook(good, s.signPayment(good));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "processed", outcome: "applied" });
    const d = await s.cp("GET", `/orders/${one.orderId}`, { token: s.adminToken });
    expect({ state: d.json.order.state, lastError: d.json.order.lastError }).toEqual({ state: "active", lastError: null });
    const [g] = await s.regPool.query<mysql.RowDataPacket[]>("SELECT status, valid_until FROM tenant_capabilities WHERE tenant_id = ?", [one.tenantId]);
    expect(g.length).toBeGreaterThanOrEqual(29);
    expect(g.every((x) => x.status === "active" && x.valid_until === null)).toBe(true);
    const [t] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT state FROM trial_requests WHERE id = ?", [one.trialId]);
    expect(t[0].state).toBe("converted");
    const [sub] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT status, trial_end FROM subscriptions WHERE id = ?", [one.subId]);
    expect(sub[0]).toMatchObject({ status: "active", trial_end: null });
    note("24 pago de prueba", `firma falsa y livemode → 400; evento firmado → applied; ${g.length} licencias activas sin caducidad; prueba convertida`);
  });

  it("paso 25: escritura recuperada", async () => {
    ok200(await s.m(one.tenantId, "crm.clients.create", { name: "Cliente tras contratar", email: "cliente-dos@demo-01.example" }, one.cookie), "clients.create");
    ok200(await s.m(one.tenantId, "crm.clients.create", { name: "Cliente de la empleada 2", email: "cliente-empleada2@demo-01.example" }, one.empCookie), "clients.create agente");
    const st = data(await s.q(one.tenantId, "setupWizard.status", undefined, one.cookie));
    expect(st.licence).toMatchObject({ plan: "essential", readOnly: false, endsAt: null });
    const ov = ok200(await s.q(one.tenantId, "subscription.overview", undefined, one.cookie), "overview");
    expect(ov.state).toBe("active");
    note("25 escritura", `altas de propietaria y empleada aceptadas; overview «${ov.state}»`);
  });

  it("paso 26: conservación de TODOS los datos creados durante la prueba", async () => {
    const now = await counts(one.tenantId);
    expect(now).toEqual({ ...before, clients: before.clients + 2 });
    const clients = (await db(one.tenantId, "SELECT email FROM clients ORDER BY id")).map((x) => x.email);
    expect(clients).toEqual(expect.arrayContaining(["cliente-uno@demo-01.example", "cliente-empleada@demo-01.example", "cliente-dos@demo-01.example"]));
    expect((await db(one.tenantId, "SELECT slug FROM experiences")).map((x) => x.slug)).toEqual([one.productSlug]);
    expect((await db(one.tenantId, "SELECT id, status FROM quotes"))).toEqual([{ id: one.quoteId, status: "aceptado" }]);
    expect((await db(one.tenantId, "SELECT invoiceNumber FROM invoices")).map((x) => x.invoiceNumber)).toEqual([one.invoiceNumber]);
    expect((await db(one.tenantId, "SELECT email FROM users ORDER BY id")).map((x) => x.email)).toEqual([one.owner, one.empEmail]);
    expect((await db(one.tenantId, "SELECT `key`, value FROM system_settings WHERE `key` = 'brand_nif'"))[0].value).toBe(TAX_ID);
    const [tenant] = await s.regPool.query<mysql.RowDataPacket[]>("SELECT id FROM tenants WHERE id = ?", [one.tenantId]);
    expect(tenant).toHaveLength(1);
    note("26 conservación", `misma plataforma; recuentos ${JSON.stringify(now)}`);
  });

  it("paso 27: cancelar la suscripción — cascada a fin de periodo (el periodo pagado se respeta)", async () => {
    const c = await s.cp("POST", `/orders/${one.orderId}/cancel`, { token: s.adminToken, body: { reason: "Fin de la prueba E2E" } });
    expect(c.status).toBe(200);
    expect(c.json.order.state).toBe("cancel_scheduled");
    const [sub] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT status, cancel_at, current_period_end FROM subscriptions WHERE id = ?", [one.subId]);
    expect(Number(sub[0].cancel_at)).toBe(Number(sub[0].current_period_end));
    // Dentro del periodo pagado se sigue operando
    expect((await s.q(one.tenantId, "crm.clients.list", { limit: 1, offset: 0 }, one.cookie)).status).toBe(200);
    s.clock.now = Number(sub[0].cancel_at) + DAY;
    const rev = await s.cp("POST", "/orders/review", { token: s.adminToken });
    expect(rev.status).toBe(200);
    expect(rev.json.cancelled).toBe(1);
    expect(rev.json.errors).toEqual([]);
    note("27 cancelación", `cancelación programada al fin de periodo; revisión tras el periodo → ${rev.json.cancelled} cancelada`);
  }, 60_000);

  it("paso 28: estado final — 30 días en solo lectura (consulta sí, escritura no), después caducado; datos intactos", async () => {
    expect((await s.cp("GET", `/orders/${one.orderId}`, { token: s.adminToken })).json.order.state).toBe("cancelled");
    const [sub] = await s.crmPool.query<mysql.RowDataPacket[]>("SELECT status, canceled_at FROM subscriptions WHERE id = ?", [one.subId]);
    expect(sub[0].status).toBe("canceled");
    const readOnlyUntil = Number(sub[0].canceled_at) + 30 * DAY;
    const [g] = await s.regPool.query<mysql.RowDataPacket[]>("SELECT status, valid_until FROM tenant_capabilities WHERE tenant_id = ?", [one.tenantId]);
    expect(g.length).toBeGreaterThan(0);
    // Regla (decisión del propietario, fase 2): 30 días en solo lectura tras el fin del periodo pagado, con
    // la sesión y el estado de la suscripción disponibles para recontratar o exportar; nada se borra.
    expect(g.every((x) => x.status === "read_only" && Number(x.valid_until) === readOnlyUntil)).toBe(true);
    expect(data(await s.q(one.tenantId, "auth.me", undefined, one.cookie))).toMatchObject({ email: one.owner });
    const ov = ok200(await s.q(one.tenantId, "subscription.overview", undefined, one.cookie), "overview");
    expect(ov.state).toBe("read_only");
    expect(ov.trial).toBeNull();
    expect(ok200(await s.q(one.tenantId, "crm.clients.list", { limit: 10, offset: 0 }, one.cookie), "lectura en solo lectura").total).toBeGreaterThan(0);
    const write = await s.m(one.tenantId, "crm.clients.create", { name: "No", email: "no2@demo-01.example" }, one.cookie);
    expect([write.status, write.json?.error?.json?.data?.status]).toEqual([403, "read_only"]);
    // Pasados los 30 días: tampoco se consulta lo licenciado (caducado); la sesión sigue y nada se borra
    const back = s.clock.now;
    s.clock.now = readOnlyUntil + 1;
    const late = await s.q(one.tenantId, "crm.clients.list", { limit: 10, offset: 0 }, one.cookie);
    expect([late.status, late.json?.error?.json?.data?.status]).toEqual([403, "expired"]);
    expect(data(await s.q(one.tenantId, "auth.me", undefined, one.cookie))).toMatchObject({ email: one.owner });
    s.clock.now = back;
    expect(await counts(one.tenantId)).toEqual({ ...before, clients: before.clients + 2 });
    const [t] = await s.regPool.query<mysql.RowDataPacket[]>("SELECT id FROM tenants WHERE id = ?", [one.tenantId]);
    expect(t).toHaveLength(1);
    // La 02 no se ve afectada por la cancelación de la 01 (sus licencias siguen siendo las suyas)
    const [g2] = await s.regPool.query<mysql.RowDataPacket[]>("SELECT DISTINCT status FROM tenant_capabilities WHERE tenant_id = ?", [two.tenantId]);
    expect(g2.map((x) => x.status)).toEqual(["active"]);
    // Ninguna salida de red real durante todo el recorrido (pasarela y correo simulados)
    expect(s.blockedFetches).toEqual([]);
    note("28 estado final", `pedido cancelled, suscripción canceled, ${g.length} licencias cancelled; login y overview «${ov.state}» sí; CRM 403 «cancelled»; datos intactos`);
  });
});
