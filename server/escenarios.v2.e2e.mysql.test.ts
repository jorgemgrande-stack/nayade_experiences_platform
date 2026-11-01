/**
 * Escenarios de USUARIO NUEVO de Elephant Core v2.0.0 con la aplicación real sobre MySQL (opt-in,
 * REGISTRY_TEST_DATABASE_URL). Dos empresas sintéticas nuevas con Essential y CAPABILITY_ENFORCEMENT=on:
 * A es una asesoría (servicios profesionales) y B un comercio. Cada escenario recorre lo que haría la
 * propietaria sin asistencia, con las mismas llamadas que hacen las pantallas:
 *
 *  1. Servicios: asistente (identidad, fiscales, marca con logotipo, actividad) → cliente → presupuesto →
 *     envío (correo falso) → aceptación y pago por el enlace público (pasarela de PRUEBAS) → pedido →
 *     factura con su numeración → vista de la factura y documento del presupuesto.
 *  2. Comercio: categorías y productos con IVA 21/10/4 → TPV (abrir caja, venta con pago dividido, cierre
 *     cuadrado) → pedido online con checkout firmado → factura.
 *  3. Web: página por bloques → publicada → servida en el host de la empresa con su título; 404 de lo que no
 *     existe → formulario de contacto → oportunidad en el CRM.
 *  4. Elephant Connect: catálogo → ficha → compra con un doble del plano de control (nunca el real) → licencia
 *     aplicada → can() y menú → suspensión → retirada; reintentos sin duplicar.
 *  5. Licencias: sin la extensión sus APIs dan 403; con licencia funcionan; suspendida en A no afecta a B.
 *  6. Multiempresa: A y B no comparten datos, archivos, permisos ni credenciales de integraciones.
 *
 * Ningún cobro real: la cuenta de la pasarela es FICTICIA (entorno de pruebas) y la notificación se firma aquí.
 * Ningún correo real: el proveedor de correo del banco de pruebas solo registra.
 *
 *   REGISTRY_TEST_DATABASE_URL=mysql://root:root@127.0.0.1:33322/registro_test \
 *     pnpm vitest run server/escenarios.v2.e2e.mysql.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { CommerceClient } from "./commerceClient";
import { startEssentialApp, data, errCode, isLicenseDenied, type EssentialApp, type Co, type Res } from "./essentialApp.testkit";

// Doble del plano de control para Elephant Connect: compras idempotentes por clave, nunca el servicio real
const cp = vi.hoisted(() => ({ orders: new Map<string, { orderId: number; tenantId: string; status: string; add: string[] }>(), created: 0, nextId: 500, failNext: false }));
vi.mock("./commerceClient", async (orig) => {
  const real = await orig<typeof import("./commerceClient")>();
  const catalog = {
    purchasesEnabled: true,
    items: [
      { key: "connect-people", name: "Connect People", family: "connect", kind: "module", metric: null, step: null, commercialStatus: "available", capabilities: ["people-hr"], monthly: { amountCents: 1900, currency: "EUR", taxIncluded: false, unit: null }, purchasable: true },
    ],
  };
  const client: Partial<CommerceClient> = {
    catalog: async () => catalog as never,
    preview: async () => ({ currency: "EUR", amountDueCents: 950, taxCents: null, lines: [], recurringDeltaCents: 1900, interval: "month" }) as never,
    purchase: async (tenantId, input, o) => {
      if (cp.failNext) {
        cp.failNext = false;
        throw new real.CommerceError(503, "unreachable", "El servicio de compras no responde.");
      }
      const k = `${tenantId}:${o.idempotencyKey}`;
      let ord = cp.orders.get(k);
      if (!ord) {
        cp.created++;
        ord = { orderId: cp.nextId++, tenantId, status: "payment_pending", add: input.add ?? [] };
        cp.orders.set(k, ord);
      }
      return { status: ord.status, orderId: ord.orderId, paymentUrl: ord.status === "payment_pending" ? "https://pago.ejemplo.invalid/prueba" : null, created: cp.created } as never;
    },
    status: async (tenantId, orderId) => {
      const ord = Array.from(cp.orders.values()).find((x) => x.orderId === orderId && x.tenantId === tenantId);
      if (!ord) throw new real.CommerceError(404, "not_found", "Pedido no encontrado");
      return { status: ord.status, orderId, paymentUrl: null } as never;
    },
  };
  return { ...real, commerceClientFromEnv: () => client as CommerceClient };
});

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
vi.setConfig({ testTimeout: 60_000 });
const YEAR = new Date().getFullYear();
const KEY_A = crypto.randomBytes(24).toString("base64");
const KEY_B = crypto.randomBytes(24).toString("base64");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(128)]);
/** Vocabulario de la instalación sectorial original: nunca debe verlo una pyme de Essential. */
const FOREIGN = /n[aá]yade|skicenter|lego ?pack|\bREAV\b|B26987875/i;

/** Notificación de la pasarela firmada como lo haría Redsys (3DES del pedido + HMAC-SHA256) con la clave dada. */
function signed(key: string, d: Record<string, string>) {
  const params = Buffer.from(JSON.stringify(d)).toString("base64");
  const k = Buffer.from(key, "base64").subarray(0, 24);
  const padded = Buffer.alloc(Math.ceil(Buffer.byteLength(d.Ds_Order) / 8) * 8, 0);
  Buffer.from(d.Ds_Order).copy(padded);
  const c = crypto.createCipheriv("des-ede3-cbc", k, Buffer.alloc(8, 0));
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

/** Petición con cuerpo binario (subida de archivos) y respuesta cruda. */
function rawRequest(port: number, host: string, method: string, p: string, o: { cookie?: string; body?: Buffer; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; body: Buffer; json: any }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method, headers: { host, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.body ? { "content-length": o.body.length } : {}), ...(o.headers ?? {}) } },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (c) => parts.push(Buffer.from(c)));
        res.on("end", () => {
          const body = Buffer.concat(parts);
          let json: any = null;
          try {
            json = JSON.parse(body.toString("utf8"));
          } catch {
            /* binario */
          }
          resolve({ status: res.statusCode ?? 0, body, json });
        });
      },
    );
    req.on("error", reject);
    if (o.body) req.write(o.body);
    req.end();
  });
}

function multipart(field: string, filename: string, type: string, content: Buffer) {
  const boundary = `----escenario${crypto.randomBytes(8).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

/** Evidencia legible por escenario (se imprime al final). */
const evidence: string[] = [];
const note = (s: string) => evidence.push(s);

describe.skipIf(!URL_)("Escenarios v2 de usuario nuevo (aplicación real, dos empresas Essential)", () => {
  let ess: EssentialApp;
  let admA = "";
  let admB = "";
  let agA = "";
  let agB = "";
  let userA = "";
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "escenarios-v2-web-"));
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "escenarios-v2-archivos-"));
  const A = { logoUrl: "", clientId: 0, productId: 0, quoteId: 0, quoteNumber: "", token: "", acceptUrl: "", merchantOrder: "", reservationId: 0, invoiceNumber: "", invoiceId: 0 };
  const B = { productIds: [] as number[], registerId: 0, sessionId: 0, saleId: 0, merchantOrder: "", invoiceNumber: "" };

  const ok = (r: Res, what: string) => {
    if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 500)}`);
    return data(r);
  };
  const status = async (co: Co, cookie: string) => ok(await ess.q(co, "setupWizard.status", undefined, cookie), "setupWizard.status");
  const stepOf = (st: any, id: string) => st.plan.steps.find((s: { id: string }) => s.id === id);

  beforeAll(async () => {
    fs.copyFileSync(path.join(__dirname, "..", "client", "index.html"), path.join(dist, "index.html"));
    // Autenticación local como en el despliegue multiempresa y en la CI (la usan también las subidas de archivos):
    // la prueba la fija ella misma para pasar sin variables externas
    process.env.LOCAL_AUTH = "true";
    ess = await startEssentialApp(URL_!, "esc", { webDist: dist });
    // Archivos en disco local temporal (el banco de pruebas deja la empresa sin S3)
    for (const k of ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"]) delete process.env[k];
    process.env.LOCAL_STORAGE_PATH = storage;
    delete process.env.STORAGE_PRIVATE_DELIVERY;
    (await import("./_core/files/backend")).resetBackendCache();
    (await import("./_core/files/service")).setFileServiceForTests(null);
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    agB = await ess.login("b", "agente");
    userA = await ess.login("a", "user");
  }, 300_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(["", "EVIDENCIA — escenarios v2 de usuario nuevo:", ...evidence.map((e) => `  · ${e}`)].join("\n"));
    await ess?.close();
    fs.rmSync(dist, { recursive: true, force: true });
    fs.rmSync(storage, { recursive: true, force: true });
  });

  // ── Escenario 1: empresa de servicios ────────────────────────────────────────────────────────────

  describe("Escenario 1 — servicios profesionales: del asistente a la factura", () => {
    it("asistente: bienvenida, identidad, datos fiscales, marca con logotipo y tipo «servicios profesionales»", async () => {
      let st = await status("a", admA);
      expect(st.nextStep).toBe("welcome");
      expect(st.activities).toContain("servicios");
      ok(await ess.m("a", "setupWizard.setStep", { step: "welcome", status: "done" }, admA), "bienvenida");

      // Identidad (lo que se valida en servidor, no solo en el formulario)
      expect(errCode(await ess.m("a", "setupWizard.saveIdentity", { tradeName: " ", country: "ES", currency: "EUR", timezone: "Europe/Madrid" }, admA))).toBe("BAD_REQUEST");
      ok(await ess.m("a", "setupWizard.saveIdentity", { tradeName: "Asesoría Norte", country: "ES", currency: "EUR", timezone: "Europe/Madrid" }, admA), "identidad");

      // Datos fiscales: llegan rellenos del registro; la empresa completa lo que falta
      st = await status("a", admA);
      expect(st.company).toMatchObject({ legalName: "Empresa A Ejemplo SL", taxId: "B00000011" });
      ok(
        await ess.m("a", "setupWizard.saveFiscal", { legalName: "Empresa A Ejemplo SL", taxId: "B00000011", address: "Calle Prueba a, 00000 Ejemplo", postalCode: "28001", city: "Madrid", province: "Madrid", publicPhone: "+34 910 000 000", publicEmail: "hola@asesoria-norte.example", publicLocation: "Madrid" }, admA),
        "fiscales",
      );

      // Marca: logotipo subido por la propia empresa y color; el paso cuenta como hecho por el dato
      const up = await rawRequest(ess.port, ess.host("a"), "POST", "/api/upload/image", { cookie: admA, ...multipart("image", "logo.png", "image/png", PNG) });
      expect(up.status).toBe(200);
      A.logoUrl = up.json.url;
      expect(A.logoUrl).toContain(ess.host("a"));
      ok(await ess.m("a", "integrations.themeSave", { values: { brand_logo_url: A.logoUrl, theme_primary_color: "#0b3d91" } }, admA), "marca");
      ok(await ess.m("a", "setupWizard.setStep", { step: "brand", status: "done" }, admA), "paso marca");
      expect(data(await ess.q("a", "public.getTheme")).primaryColor).toBe("#0b3d91");

      const act = ok(await ess.m("a", "setupWizard.saveActivity", { activity: "servicios" }, admA), "actividad");
      st = await status("a", admA);
      expect(st.activity).toBe("servicios");
      expect(st.profile).toBe("servicios");
      const label = (await import("../shared/setupWizard")).activityInfo(st.activity).label;
      expect(label).toBe("Servicios profesionales");
      for (const id of ["welcome", "company", "fiscal", "brand", "activity"]) expect(stepOf(st, id)?.status, id).toBe("done");
      expect(stepOf(st, "brand").byData).toBe(true);
      // Servicios: el cliente va antes que el producto
      const ids = st.plan.steps.map((s: { id: string }) => s.id);
      expect(ids.indexOf("client")).toBeLessThan(ids.indexOf("product"));
      expect(act.nextStep).toBe("client");
      note(`1 asistente: identidad, fiscales, marca (logotipo ${A.logoUrl.split("/").pop()}) y actividad «${label}»; siguiente «${act.nextStep}»`);
    });

    it("cliente y servicio (IVA 21 %) creados desde los pasos del asistente; cuentan como hechos por el dato", async () => {
      ok(await ess.m("a", "crm.clients.create", { name: "Marta Cliente", email: "marta@cliente-a.example", phone: "600000001" }, admA), "cliente");
      A.clientId = Number((await ess.sql("a", "SELECT id FROM clients WHERE email = 'marta@cliente-a.example'"))[0].id);
      // Lo mismo que hace el paso «Productos o servicios» del asistente
      const cat = ok(await ess.m("a", "products.createCategory", { slug: "asesoria", name: "Asesoría" }, admA), "categoría");
      const loc = ok(await ess.m("a", "products.createLocation", { slug: "oficina", name: "Oficina" }, admA), "ubicación");
      ok(await ess.m("a", "products.create", { slug: "sesion-asesoria", title: "Sesión de asesoría (1 hora)", categoryId: cat.id, locationId: loc.id, basePrice: "60.00", taxRate: "21", pricingType: "per_unit" }, admA), "producto");
      A.productId = Number((await ess.sql("a", "SELECT id FROM experiences WHERE slug = 'sesion-asesoria'"))[0].id);
      const st = await status("a", admA);
      expect(stepOf(st, "client")).toMatchObject({ status: "done", byData: true });
      expect(stepOf(st, "product")).toMatchObject({ status: "done", byData: true });
      note(`1 cliente #${A.clientId} y servicio #${A.productId} (60 € IVA 21 %)`);
    });

    it("presupuesto → envío: en la prueba gratuita NO sale al cliente y se avisa; contratada, sale con su enlace", async () => {
      const r = ok(
        await ess.m("a", "crm.quotes.createDirect", { clientName: "Marta Cliente", clientEmail: "marta@cliente-a.example", title: "Asesoría fiscal trimestral", items: [{ description: "Sesión de asesoría (1 hora)", quantity: 2, unitPrice: 72.6, total: 145.2, taxRate: 21, productId: A.productId }], subtotal: 120, taxRate: 21, total: 145.2, sendNow: false }, agA),
        "presupuesto",
      );
      A.quoteId = Number(r.quoteId);
      A.quoteNumber = String(r.quoteNumber);
      expect(A.quoteNumber).toBe(`PRES-${YEAR}-0001`);
      const toClient = (from: number) => ess.mails.slice(from).find((m) => m.to.some((t) => t.email === "marta@cliente-a.example"));

      // Prueba gratuita: el correo a terceros no sale (política de la prueba) y la respuesta lo dice
      let before = ess.mails.length;
      const sent = ok(await ess.m("a", "crm.quotes.send", { id: A.quoteId, origin: `https://${ess.host("a")}` }, agA), "envío en prueba");
      A.token = sent.token;
      A.acceptUrl = sent.acceptUrl;
      expect(A.acceptUrl).toBe(`https://${ess.host("a")}/presupuesto/${A.token}`);
      expect([sent.emailSent, sent.trialMailBlocked]).toEqual([false, true]);
      expect(toClient(before)).toBeUndefined();
      const { quoteMailNotice } = await import("../shared/quoteMailNotice");
      expect(quoteMailNotice(sent, "Presupuesto enviado al cliente").message).toMatch(/prueba gratuita.*Copia el enlace/);

      // La empresa contrata Essential: el reenvío sí llega al cliente con el enlace en el host de la empresa
      await ess.markPaid("a");
      before = ess.mails.length;
      const resent = ok(await ess.m("a", "crm.quotes.resend", { id: A.quoteId, origin: `https://${ess.host("a")}` }, agA), "reenvío");
      expect([resent.emailSent, resent.trialMailBlocked]).toEqual([true, false]);
      const mail = await waitFor(async () => toClient(before), (m) => !!m);
      expect(mail).toBeTruthy();
      A.acceptUrl = resent.acceptUrl ?? A.acceptUrl;
      A.token = A.acceptUrl.split("/").pop()!;
      expect(A.acceptUrl).toContain(ess.host("a"));
      expect(mail!.htmlContent).toContain(A.acceptUrl);
      expect(mail!.subject).toContain("Asesoría Norte");
      expect(mail!.subject + mail!.htmlContent).not.toMatch(FOREIGN);
      expect((await ess.sql("a", "SELECT status FROM quotes WHERE id = ?", [A.quoteId]))[0].status).toBe("enviado");
      note(`1 presupuesto ${A.quoteNumber} 145,20 €: en prueba emailSent=false + aviso «copia el enlace»; contratada → correo «${mail!.subject}» con enlace en ${ess.host("a")}`);
    });

    it("aceptación por el enlace público: el cliente lo ve y paga en la pasarela de PRUEBAS → pedido y factura", async () => {
      // Sin sesión, solo con el enlace
      const view = ok(await ess.q("a", "crm.quotes.getByToken", { token: A.token }), "ver presupuesto");
      expect(JSON.stringify(view)).toContain("Asesoría fiscal trimestral");
      expect(JSON.stringify(view)).not.toMatch(FOREIGN);
      // El enlace de A no existe en la web de B
      expect(errCode(await ess.q("b", "crm.quotes.getByToken", { token: A.token }))).toBe("NOT_FOUND");

      ok(await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008881", merchantTerminal: "1", merchantKey: KEY_A } }, admA), "pasarela");
      const pay = ok(await ess.m("a", "crm.quotes.payWithToken", { token: A.token, origin: `https://${ess.host("a")}` }), "pagar");
      expect(pay.redsysForm?.url ?? pay.url).toContain("sis-t.redsys.es");
      const params = JSON.parse(Buffer.from(pay.redsysForm?.Ds_MerchantParameters ?? pay.redsysForm?.params?.Ds_MerchantParameters, "base64").toString());
      A.merchantOrder = params.DS_MERCHANT_ORDER ?? params.Ds_Merchant_Order;
      expect(Number(params.DS_MERCHANT_AMOUNT ?? params.Ds_Merchant_Amount)).toBe(14520);
      const ipn = await ess.call("a", "POST", "/api/redsys/notification", { raw: signed(KEY_A, { Ds_Order: A.merchantOrder, Ds_Response: "0000", Ds_Amount: "14520", Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
      expect(ipn.text).toBe("OK");
      const q = await waitFor(() => ess.sql("a", "SELECT status, paidAt, invoiceNumber FROM quotes WHERE id = ?", [A.quoteId]), (rows) => !!rows[0]?.invoiceNumber);
      expect(q[0].status).toBe("aceptado");
      expect(q[0].paidAt).not.toBeNull();
      const [res] = await ess.sql("a", "SELECT id, status, amount_total AS amountTotal FROM reservations WHERE quote_id = ?", [A.quoteId]);
      A.reservationId = Number(res.id);
      expect(res).toMatchObject({ status: "paid", amountTotal: 14520 });
      const [inv] = await ess.sql("a", "SELECT id, invoiceNumber, subtotal, taxAmount, total, taxBreakdown, status FROM invoices WHERE quoteId = ?", [A.quoteId]);
      A.invoiceId = Number(inv.id);
      A.invoiceNumber = inv.invoiceNumber;
      expect(A.invoiceNumber).toBe(`FAC-${YEAR}-0001`);
      // Líneas con IVA incluido: lo cobrado (145,20 €) es el total y se desglosa en 120,00 + 25,20
      expect([Number(inv.subtotal), Number(inv.taxAmount), Number(inv.total)]).toEqual([120, 25.2, 145.2]);
      expect(typeof inv.taxBreakdown === "string" ? JSON.parse(inv.taxBreakdown) : inv.taxBreakdown).toEqual([{ rate: 21, base: 120, amount: 25.2 }]);
      // El enlace ya pagado no se puede volver a cobrar
      expect(errCode(await ess.m("a", "crm.quotes.payWithToken", { token: A.token, origin: `https://${ess.host("a")}` }))).toBe("BAD_REQUEST");
      // Y el enlace del correo sigue abriendo el presupuesto, ya como pagado (con su factura)
      const paidView = ok(await ess.q("a", "crm.quotes.getByToken", { token: A.token }), "ver presupuesto pagado");
      expect(paidView).toMatchObject({ id: A.quoteId, isPaid: true, status: "aceptado", invoiceNumber: A.invoiceNumber });
      expect(errCode(await ess.q("b", "crm.quotes.getByToken", { token: A.token }))).toBe("NOT_FOUND");
      // La misma notificación repetida no duplica la factura
      await ess.call("a", "POST", "/api/redsys/notification", { raw: signed(KEY_A, { Ds_Order: A.merchantOrder, Ds_Response: "0000", Ds_Amount: "14520", Ds_AuthorisationCode: "123456" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
      expect(Number((await ess.sql("a", "SELECT COUNT(*) AS n FROM invoices WHERE quoteId = ?", [A.quoteId]))[0].n)).toBe(1);
      note(`1 aceptación pública: pago de PRUEBAS ${A.merchantOrder} 145,20 € → presupuesto aceptado, pedido #${A.reservationId} pagado, factura ${A.invoiceNumber}`);
    });

    it("factura: en el listado, vista con la identidad fiscal de la empresa; documento del presupuesto", async () => {
      const list = ok(await ess.q("a", "crm.invoices.listAll", {}, agA), "facturas");
      expect(list.total).toBe(1);
      const prev = await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(A.invoiceNumber)}`, { cookie: agA });
      expect(prev.status).toBe(200);
      expect(prev.text).toContain("B00000011");
      expect(prev.text).toContain(A.invoiceNumber);
      expect(prev.text).not.toMatch(FOREIGN);
      // Documento descargable del presupuesto (PDF, o HTML si el motor de PDF no está en este entorno)
      const doc = ok(await ess.m("a", "crm.quotes.generatePdf", { id: A.quoteId }, agA), "documento del presupuesto");
      expect(doc.filename).toMatch(new RegExp(`^Presupuesto-${A.quoteNumber}\\.(pdf|html)$`));
      note(`1 vista de ${A.invoiceNumber} con NIF B00000011 sin textos ajenos; documento del presupuesto «${doc.filename}»`);
    });

    it("factura libre a un cliente con dos tipos de IVA → numeración correlativa; anularla emite un abono total", async () => {
      const r = ok(
        await ess.m("a", "crm.invoices.createDirect", { clientId: A.clientId, lines: [{ description: "Gestión de nóminas (mes)", quantity: 1, unitPrice: 100, taxRate: 21 }, { description: "Curso de formación", quantity: 2, unitPrice: 50, taxRate: 0, exemptionReason: "Operación exenta de IVA (art. 20 de la Ley 37/1992 del IVA)" }] }, agA),
        "factura libre",
      );
      expect(r.invoiceNumber).toBe(`FAC-${YEAR}-0002`);
      expect(r.total).toBe(221);
      const [inv] = await ess.sql("a", "SELECT id, subtotal, taxAmount, total, status, clientName FROM invoices WHERE id = ?", [r.invoiceId]);
      expect([Number(inv.subtotal), Number(inv.taxAmount), Number(inv.total), inv.clientName]).toEqual([200, 21, 221, "Marta Cliente"]);
      const prev = await ess.call("a", "GET", `/api/invoices/preview?n=${encodeURIComponent(r.invoiceNumber)}`, { cookie: agA });
      expect(prev.status).toBe(200);
      expect(prev.text).toContain("Gestión de nóminas");

      const v = ok(await ess.m("a", "crm.invoices.void", { invoiceId: r.invoiceId, reason: "Emitida por error" }, agA), "anular");
      expect(v.creditNoteNumber).toMatch(/^ABO-/);
      const [orig] = await ess.sql("a", "SELECT status FROM invoices WHERE id = ?", [r.invoiceId]);
      expect(orig.status).toBe("abonada");
      const [abono] = await ess.sql("a", "SELECT invoiceType, total, creditNoteForId FROM invoices WHERE id = ?", [v.creditNoteId]);
      expect([abono.invoiceType, Number(abono.total), Number(abono.creditNoteForId)]).toEqual(["abono", -221, r.invoiceId]);
      // No se anula dos veces ni se anula un abono
      expect(errCode(await ess.m("a", "crm.invoices.void", { invoiceId: r.invoiceId }, agA))).toBe("BAD_REQUEST");
      expect(errCode(await ess.m("a", "crm.invoices.void", { invoiceId: v.creditNoteId }, agA))).toBe("BAD_REQUEST");
      // La siguiente factura no reutiliza números
      const next = ok(await ess.m("a", "crm.invoices.createDirect", { client: { name: "Cliente Puntual" }, lines: [{ description: "Consulta", quantity: 1, unitPrice: 40, taxRate: 21 }] }, agA), "otra factura libre");
      expect(next.invoiceNumber).toBe(`FAC-${YEAR}-0003`);
      note(`1 factura libre ${r.invoiceNumber} 221 € (IVA 21 % + 0 %) → anulada: abono ${v.creditNoteNumber} −221 €, original «abonada»; siguiente ${next.invoiceNumber}`);
    });
  });

  // ── Escenario 2: comercio ─────────────────────────────────────────────────────────────────────────

  describe("Escenario 2 — comercio: catálogo con tres tipos de IVA, TPV y pedido online", () => {
    it("tipo «comercio», categorías y productos con IVA 21 %, 10 % y 4 % vendibles en el mostrador", async () => {
      ok(await ess.m("b", "setupWizard.saveActivity", { activity: "comercio" }, admB), "actividad");
      const st = await status("b", admB);
      expect(st.plan.steps.filter((s: { recommended: boolean }) => s.recommended).map((s: { id: string }) => s.id)).toEqual(["product", "operation"]);
      const loc = ok(await ess.m("b", "products.createLocation", { slug: "tienda", name: "Tienda" }, admB), "ubicación");
      const items: Array<[string, string, string, string, string]> = [
        ["menaje", "Menaje", "taza-ceramica", "Taza de cerámica", "21"],
        ["alimentacion", "Alimentación", "aceite-oliva", "Aceite de oliva 1 l", "10"],
        ["libreria", "Librería", "libro-cocina", "Libro de cocina", "4"],
      ];
      const prices: Record<string, string> = { "taza-ceramica": "12.10", "aceite-oliva": "11.00", "libro-cocina": "20.80" };
      for (const [cslug, cname, slug, title, tax] of items) {
        const cat = ok(await ess.m("b", "products.createCategory", { slug: cslug, name: cname }, admB), `categoría ${cname}`);
        ok(await ess.m("b", "products.create", { slug, title, categoryId: cat.id, locationId: loc.id, basePrice: prices[slug], taxRate: tax, pricingType: "per_unit", isPresentialSale: true }, admB), `producto ${title}`);
      }
      const rows = await ess.sql("b", "SELECT id, slug, taxRate FROM experiences ORDER BY id");
      B.productIds = rows.map((r) => Number(r.id));
      expect(rows.map((r) => [r.slug, Number(r.taxRate)])).toEqual([["taza-ceramica", 21], ["aceite-oliva", 10], ["libro-cocina", 4]]);
      const cat = ok(await ess.q("b", "tpv.getCatalog", undefined, agB), "catálogo TPV");
      expect(cat.categories.map((c: { name: string }) => c.name).sort()).toEqual(["Alimentación", "Librería", "Menaje"]);
      expect(cat.experiences.map((e: { title: string }) => e.title)).toHaveLength(3);
      note("2 catálogo de B: 3 categorías y 3 productos con IVA 21/10/4 visibles en el TPV");
    });

    it("TPV: abrir caja, venta de los tres productos con pago dividido, IVA por línea y cierre cuadrado", async () => {
      B.registerId = ok(await ess.m("b", "tpv.createRegister", { name: "Mostrador" }, admB), "caja").id;
      const s = ok(await ess.m("b", "tpv.openSession", { registerId: B.registerId, openingAmount: 100 }, agB), "abrir caja");
      B.sessionId = s.id;
      const [taza, aceite, libro] = B.productIds;
      const sale = ok(
        await ess.m("b", "tpv.createSale", {
          sessionId: B.sessionId,
          customerName: "Pedro Comprador",
          customerEmail: "pedro@cliente-b.example",
          items: [
            { productType: "experience", productId: taza, productName: "Taza de cerámica", quantity: 2, unitPrice: 12.1 },
            { productType: "experience", productId: aceite, productName: "Aceite de oliva 1 l", quantity: 1, unitPrice: 11 },
            { productType: "experience", productId: libro, productName: "Libro de cocina", quantity: 1, unitPrice: 20.8 },
          ],
          payments: [{ method: "cash", amount: 30 }, { method: "card", amount: 26 }],
        }, agB),
        "venta",
      );
      expect(sale.sale.status).toBe("paid");
      B.saleId = sale.sale.id;
      const lines = await ess.sql("b", "SELECT productName, taxRate_tsi AS taxRate, taxBase_tsi AS taxBase, taxAmount_tsi AS taxAmount, subtotal_tsi AS subtotal FROM tpv_sale_items WHERE saleId = ? ORDER BY id", [B.saleId]);
      expect(lines.map((l) => [Number(l.taxRate), Number(l.taxBase), Number(l.taxAmount)])).toEqual([
        [21, 20, 4.2],
        [10, 10, 1],
        [4, 20, 0.8],
      ]);
      const sum = ok(await ess.q("b", "tpv.getSessionSummary", { sessionId: B.sessionId }, agB), "resumen");
      expect([sum.totalCash, sum.totalCard]).toEqual([30, 26]);
      // Efectivo esperado: 100 de apertura + 30 cobrados
      const closed = ok(await ess.m("b", "tpv.closeSession", { sessionId: B.sessionId, countedCash: 130 }, agB), "cierre");
      expect(Number(closed.cashDifference)).toBe(0);
      note(`2 TPV de B: venta #${B.saleId} de 56 € (30 efectivo + 26 tarjeta), IVA 4,20/1,00/0,80, cierre con descuadre 0`);
    });

    it("pedido online: checkout con la pasarela de PRUEBAS de B, notificación firmada y factura con la numeración de B", async () => {
      ok(await ess.m("b", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "999008882", merchantTerminal: "1", merchantKey: KEY_B } }, admB), "pasarela B");
      const out = ok(await ess.m("b", "reservations.createAndPay", { productId: B.productIds[1], bookingDate: "2030-06-01", people: 2, customerName: "Cliente Web B", customerEmail: "web@cliente-b.example", origin: `https://${ess.host("b")}` }), "checkout");
      expect(out.amountCents).toBe(2200);
      expect(out.redsysForm.url).toContain("sis-t.redsys.es");
      B.merchantOrder = out.merchantOrder;
      // Firmada con la clave de A: rechazada en B
      const forged = await ess.call("b", "POST", "/api/redsys/notification", { raw: signed(KEY_A, { Ds_Order: out.merchantOrder, Ds_Response: "0000", Ds_Amount: "2200" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
      expect(forged.text).not.toBe("OK");
      const ipn = await ess.call("b", "POST", "/api/redsys/notification", { raw: signed(KEY_B, { Ds_Order: out.merchantOrder, Ds_Response: "0000", Ds_Amount: "2200", Ds_AuthorisationCode: "654321" }), headers: { "content-type": "application/x-www-form-urlencoded" } });
      expect(ipn.text).toBe("OK");
      const [res] = await waitFor(() => ess.sql("b", "SELECT id, status FROM reservations WHERE merchant_order = ?", [out.merchantOrder]), (r) => r[0]?.status === "paid");
      expect(res.status).toBe("paid");
      const inv = await waitFor(() => ess.sql("b", "SELECT invoiceNumber, total, taxAmount FROM invoices WHERE reservationId = ?", [res.id]), (r) => r.length > 0);
      B.invoiceNumber = inv[0].invoiceNumber;
      // Numeración propia de B, independiente de la de A
      expect(B.invoiceNumber).toBe(`FAC-${YEAR}-0001`);
      expect(Number(inv[0].total)).toBe(22);
      // IVA del producto (10 %) incluido en el precio
      expect(Number(inv[0].taxAmount)).toBeCloseTo(2, 2);
      const prev = await ess.call("b", "GET", `/api/invoices/preview?n=${encodeURIComponent(B.invoiceNumber)}`, { cookie: agB });
      expect(prev.status).toBe(200);
      expect(prev.text).toContain("B00000022");
      expect(prev.text).not.toContain("B00000011");
      note(`2 pedido online ${B.merchantOrder} 22 € pagado (firma con la clave de A rechazada) → factura ${B.invoiceNumber} con IVA 2,00 €`);
    });
  });

  // ── Escenario 3: web ──────────────────────────────────────────────────────────────────────────────

  describe("Escenario 3 — web: página por bloques, publicada en su host, contacto → oportunidad", () => {
    it("página por bloques en borrador (404) → publicada (200 con su título) en el host de A; 404 de lo inexistente", async () => {
      ok(await ess.m("a", "cms.upsertPage", { slug: "nuestros-servicios", title: "Nuestros servicios", isPublished: false, metaDescription: "Asesoría fiscal y laboral" }, admA), "página");
      ok(await ess.m("a", "cms.savePageBlocks", { pageSlug: "nuestros-servicios", blocks: [{ blockType: "hero", sortOrder: 0, data: { title: "Asesoría Norte" } }, { blockType: "text", sortOrder: 1, data: { html: "<p>Fiscal, laboral y contable</p>" } }] }, admA), "bloques");
      expect((await ess.call("a", "GET", "/nuestros-servicios")).status).toBe(404);
      ok(await ess.m("a", "cms.upsertPage", { slug: "nuestros-servicios", title: "Nuestros servicios", isPublished: true, metaDescription: "Asesoría fiscal y laboral" }, admA), "publicar");
      (await import("./config")).invalidateConfigCacheForTenant(ess.ids.a);
      const page = await ess.call("a", "GET", "/nuestros-servicios");
      expect(page.status).toBe(200);
      expect(page.text).toContain("<title>Nuestros servicios | Asesoría Norte</title>");
      expect(page.text).toContain('<meta name="description" content="Asesoría fiscal y laboral"');
      expect(page.text).not.toMatch(FOREIGN);
      expect(data(await ess.q("a", "public.getPublicPageBlocks", { slug: "nuestros-servicios" })).map((b: { blockType: string }) => b.blockType)).toEqual(["hero", "text"]);
      const home = await ess.call("a", "GET", "/");
      expect(home.text).toContain("<title>Asesoría Norte</title>");
      expect((await ess.call("a", "GET", "/no-existe")).status).toBe(404);
      // Otra empresa, ni la página ni el título
      const pb = await ess.call("b", "GET", "/nuestros-servicios");
      expect(pb.status).toBe(404);
      expect(pb.text).not.toContain("Asesoría Norte");
      note("3 web de A: /nuestros-servicios 404 en borrador → 200 con «Nuestros servicios | Asesoría Norte»; /no-existe 404; en B 404");
    });

    it("formulario de contacto de la web → oportunidad en el CRM de A (solo de A)", async () => {
      ok(await ess.m("a", "public.submitLead", { name: "Lucía Visitante", email: "lucia@visitante.example", phone: "600000002", message: "Asunto: Información\n\nQuiero una cita", source: "web_contacto" }), "contacto");
      const leads = ok(await ess.q("a", "crm.leads.list", {}, agA), "oportunidades");
      const lead = leads.rows.find((l: { email: string }) => l.email === "lucia@visitante.example");
      expect(lead).toBeTruthy();
      expect(lead.opportunityStatus ?? lead.status).toBeTruthy();
      expect(ok(await ess.q("b", "crm.leads.list", {}, agB), "oportunidades B").rows.some((l: { email: string }) => l.email === "lucia@visitante.example")).toBe(false);
      note(`3 contacto web → oportunidad #${lead.id} en el CRM de A (estado ${lead.opportunityStatus ?? lead.status}); B no la ve`);
    });
  });

  // ── Escenarios 4 y 5: Elephant Connect y licencias ───────────────────────────────────────────────

  describe("Escenarios 4 y 5 — Elephant Connect y licencias por empresa", () => {
    const menu = async (co: Co, cookie: string) => {
      const { capabilityStateFrom, resolveNav, TASK_NAV } = await import("../shared/adminNav");
      const ov = ok(await ess.q(co, "subscription.overview", undefined, cookie), "overview");
      const can = capabilityStateFrom(ov);
      const nav = resolveNav(TASK_NAV, { role: "admin", isFlagVisible: () => true, isModuleVisible: () => true, capabilityState: can });
      // Entradas que aportan las extensiones contratadas, declaradas en su manifiesto (People → «Personal»)
      const ext = ok(await ess.q(co, "panel.navigation", undefined, cookie), "panel.navigation") as { entries: Array<{ moduleId: string; item?: { label: string; href: string } }> };
      const declared = ext.entries.filter((e) => e.item).map((e) => ({ moduleId: e.moduleId, label: e.item!.label, href: e.item!.href }));
      return { can, declared, hrefs: [...nav.flatMap((s) => s.items.map((i) => i.href)), ...declared.map((d) => d.href)] };
    };
    const item = async (co: Co, cookie: string) => (ok(await ess.q(co, "connect.catalog", undefined, cookie), "catálogo Connect").items as any[]).find((i) => i.key === "connect-people");

    it("sin la extensión: no está en el menú, can() es falso y sus APIs dan 403 por licencia (en A y en B)", async () => {
      for (const [co, cookie] of [["a", admA], ["b", admB]] as const) {
        const m = await menu(co, cookie);
        expect(m.can("people-hr")).toBeNull();
        expect(m.hrefs).not.toContain("/admin/personal");
        expect(isLicenseDenied(await ess.q(co, "hr.employees.list", {}, cookie), "people-hr")).toBe(true);
        expect(isLicenseDenied(await ess.m(co, "hr.employees.create", { name: "Ana Empleada" }, cookie), "people-hr")).toBe(true);
      }
      note("5 sin Connect People: hr.employees.list y hr.employees.create → 403 con capability=people-hr en A y B; sin entrada de menú");
    });

    it("catálogo y ficha → compra (doble del plano de control) con reintento sin duplicar → licencia → can() y menú", async () => {
      // B sigue en prueba gratuita: no hay suscripción que ampliar; ve el catálogo con el motivo, sin comprar
      const trial = ok(await ess.q("b", "connect.catalog", undefined, admB), "catálogo en prueba");
      expect([trial.available, trial.canPurchase, trial.purchaseBlock]).toEqual([true, false, "trial"]);
      expect(errCode(await ess.m("b", "subscription.purchase", { add: ["connect-people"], idempotencyKey: "clave-en-prueba-00000001" }, admB))).toBe("FORBIDDEN");
      // A ya contrató Essential (escenario 1): puede ampliar
      const cat = ok(await ess.q("a", "connect.catalog", undefined, admA), "catálogo");
      expect([cat.available, cat.canPurchase, cat.purchaseBlock]).toEqual([true, true, null]);
      const ficha = await item("a", admA);
      expect([ficha.state, ficha.purchasable, ficha.name]).toEqual(["available", true, "Connect People"]);
      expect(JSON.stringify(cat)).not.toMatch(FOREIGN);
      // Comercial o cliente: no compran
      expect(errCode(await ess.m("a", "subscription.purchase", { add: ["connect-people"], idempotencyKey: "clave-agente-0000000001" }, agA))).toBe("FORBIDDEN");

      const key = `intento-${crypto.randomBytes(8).toString("hex")}`;
      cp.failNext = true;
      expect(errCode(await ess.m("a", "subscription.purchase", { add: ["connect-people"], idempotencyKey: key }, admA))).toBe("PRECONDITION_FAILED");
      const r1 = ok(await ess.m("a", "subscription.purchase", { add: ["connect-people"], idempotencyKey: key }, admA), "compra");
      const r2 = ok(await ess.m("a", "subscription.purchase", { add: ["connect-people"], idempotencyKey: key }, admA), "reintento");
      expect(r2.orderId).toBe(r1.orderId);
      expect(cp.created).toBe(1);
      expect(r1.status).toBe("payment_pending");
      // Volver de la página de pago no activa nada sin la confirmación del plano de control
      expect((await item("a", admA)).state).toBe("available");
      expect(isLicenseDenied(await ess.q("a", "hr.employees.list", {}, admA), "people-hr")).toBe(true);

      // Cobro verificado en el plano de control (doble): licencia en el registro y pedido aplicado
      await ess.setCapability("a", "people-hr", "active");
      Array.from(cp.orders.values()).find((o) => o.orderId === r1.orderId)!.status = "applied";
      expect(ok(await ess.q("a", "subscription.purchaseStatus", { orderId: r1.orderId }, admA), "estado").status).toBe("applied");
      const m = await menu("a", admA);
      expect(m.can("people-hr")).toBe("active");
      expect(m.hrefs).toContain("/admin/personal");
      expect(m.declared).toEqual([{ moduleId: "people", label: "Personal", href: "/admin/personal" }]);
      expect((await item("a", admA)).state).toBe("active");
      // Su API funciona
      expect(ok(await ess.q("a", "hr.employees.list", {}, admA), "hr.employees.list")).toBeTruthy();
      // B no lo tiene ni ve el pedido de A
      expect((await menu("b", admB)).hrefs).not.toContain("/admin/personal");
      expect(errCode(await ess.q("b", "subscription.purchaseStatus", { orderId: r1.orderId }, admB))).toBe("NOT_FOUND");
      note(`4 Connect: compra #${r1.orderId} (fallo de red + 2 reintentos con la misma clave → 1 pedido) → licencia → menú /admin/personal y hr.employees.list 200`);
    });

    it("con licencia en las dos; suspendida en A: se retira de A sin afectar a B; retirada definitiva", async () => {
      await ess.setCapability("b", "people-hr", "active");
      expect((await ess.q("b", "hr.employees.list", {}, admB)).status).toBe(200);

      await ess.setCapability("a", "people-hr", "suspended");
      const mA = await menu("a", admA);
      expect(mA.can("people-hr")).toBeNull();
      expect(mA.hrefs).not.toContain("/admin/personal");
      expect((await item("a", admA)).state).toBe("incident");
      expect(isLicenseDenied(await ess.q("a", "hr.employees.list", {}, admA), "people-hr")).toBe(true);
      // B sigue igual
      expect((await ess.q("b", "hr.employees.list", {}, admB)).status).toBe(200);
      expect((await menu("b", admB)).hrefs).toContain("/admin/personal");

      await ess.setCapability("a", "people-hr", null);
      expect((await item("a", admA)).state).toBe("available");
      expect(isLicenseDenied(await ess.q("a", "hr.employees.list", {}, admA), "people-hr")).toBe(true);
      expect((await ess.q("b", "hr.employees.list", {}, admB)).status).toBe(200);
      await ess.setCapability("b", "people-hr", null);
      note("4–5 suspensión en A: fuera del menú, «con incidencia», hr.employees.list 403; B sigue con 200; retirada → «disponible» otra vez");
    });
  });

  // ── Escenario 6: multiempresa ─────────────────────────────────────────────────────────────────────

  describe("Escenario 6 — multiempresa: datos, archivos, permisos y credenciales separados", () => {
    it("datos: B no ve clientes, presupuestos, facturas, ventas ni pedidos de A (ni por identificador)", async () => {
      expect(ok(await ess.q("b", "crm.clients.list", { limit: 50, offset: 0 }, agB), "clientes B").items.some((c: { email: string }) => c.email === "marta@cliente-a.example")).toBe(false);
      // B no tiene presupuestos: el de A no existe allí
      expect(errCode(await ess.q("b", "crm.quotes.get", { id: A.quoteId }, agB))).toBe("NOT_FOUND");
      // Cada empresa numera sus propias filas desde 1: el mismo identificador en B es SU factura o SU pedido, nunca el de A
      for (const [proc, id] of [["crm.invoices.get", A.invoiceId], ["crm.reservations.get", A.reservationId]] as const) {
        const r = await ess.q("b", proc, { id }, agB);
        expect(r.text, proc).not.toContain("Marta Cliente");
        expect(r.text, proc).not.toContain("marta@cliente-a.example");
        expect(r.text, proc).not.toContain(A.quoteNumber);
      }
      expect(ok(await ess.q("a", "tpv.getRegisters", undefined, agA), "cajas A")).toEqual([]);
      const saleFromA = await ess.q("a", "tpv.getSale", { saleId: B.saleId }, agA);
      expect(saleFromA.text).not.toContain("Pedro Comprador");
      const prevB = await ess.call("b", "GET", `/api/invoices/preview?n=${encodeURIComponent(A.invoiceNumber)}`, { cookie: agB });
      expect(prevB.text).not.toContain("B00000011");
      expect(prevB.text).not.toContain("Marta Cliente");
      const listB = JSON.stringify(ok(await ess.q("b", "crm.invoices.listAll", {}, agB), "facturas B"));
      expect(listB).not.toContain("Marta Cliente");
      note("6 datos: clientes, presupuesto, factura, pedido y venta de la otra empresa → vacío o NOT_FOUND");
    });

    it("archivos: el logotipo de A no se sirve en el host de B", async () => {
      const p = new URL(A.logoUrl).pathname;
      expect((await rawRequest(ess.port, ess.host("a"), "GET", p)).status).toBe(200);
      expect((await rawRequest(ess.port, ess.host("b"), "GET", p)).status).toBe(404);
      note(`6 archivos: ${p} 200 en A, 404 en B`);
    });

    it("permisos: la sesión de A no vale en B; agente y cliente no administran; sin sesión, 401", async () => {
      expect((await ess.q("b", "crm.clients.list", { limit: 5, offset: 0 }, admA)).status).toBe(401);
      expect((await ess.q("b", "setupWizard.status", undefined, admA)).status).toBe(401);
      expect(errCode(await ess.m("a", "integrations.save", { provider: "redsys", values: { environment: "test", merchantCode: "1", merchantTerminal: "1", merchantKey: KEY_B } }, agA))).toBe("FORBIDDEN");
      expect(errCode(await ess.q("a", "crm.invoices.listAll", {}, userA))).toBe("FORBIDDEN");
      expect((await ess.q("a", "crm.invoices.listAll", {})).status).toBe(401);
      note("6 permisos: cookie de A en B → 401; agente no guarda credenciales; cliente sin CRM; anónimo 401");
    });

    it("credenciales: cada empresa ve solo sus integraciones, enmascaradas; cifradas en su BD", async () => {
      const la = JSON.stringify(ok(await ess.q("a", "integrations.list", undefined, admA), "integraciones A"));
      const lb = JSON.stringify(ok(await ess.q("b", "integrations.list", undefined, admB), "integraciones B"));
      expect(la).not.toContain(KEY_A);
      expect(lb).not.toContain(KEY_B);
      expect(la).not.toContain("999008882");
      expect(lb).not.toContain("999008881");
      const rowA = await ess.sql("a", "SELECT value FROM integration_credentials WHERE provider = 'redsys' AND field = 'merchantKey'");
      expect(rowA).toHaveLength(1);
      expect(String(rowA[0].value)).not.toContain(KEY_A);
      expect((await ess.sql("b", "SELECT value FROM integration_credentials WHERE provider = 'redsys' AND field = 'merchantKey'")).map((r) => String(r.value))).not.toContain(String(rowA[0].value));
      note("6 credenciales: listado enmascarado, sin claves ni códigos de comercio de la otra empresa; cifradas en cada BD");
    });

    it("ninguna pantalla de datos de la empresa arrastra vocabulario de otra instalación", async () => {
      const st = JSON.stringify(await status("a", admA));
      expect(st).not.toMatch(FOREIGN);
      const home = JSON.stringify(ok(await ess.q("a", "coreHome.recentActivity", undefined, agA), "actividad reciente"));
      expect(home).not.toMatch(FOREIGN);
      expect(home).toContain("Marta Cliente");
      note("6 asistente e Inicio de A sin vocabulario ajeno; Inicio muestra su actividad real");
    });
  });
});
