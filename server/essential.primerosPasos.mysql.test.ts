/**
 * «Primeros pasos» v3 e indicadores del Inicio con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Dos empresas nuevas desde la baseline:
 *  - cada paso se marca solo con el dato real (un clic en «hecho» no cuenta), también la marca y el correo;
 *  - primera venta y primer presupuesto o factura son pasos distintos;
 *  - el progreso vive en el servidor: otra sesión ve lo mismo; se omite un paso y se retoma;
 *  - NIF/CIF y código postal españoles comprobados en el servidor;
 *  - indicadores del Inicio: cifras reales de la empresa, cero sin datos, por licencia y por rol, sin mezclar empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

type Step = { id: string; status: string; byData: boolean };
const stepOf = (p: { steps: Step[] }, id: string) => p.steps.find((s) => s.id === id);

describe.skipIf(!URL_)("Primeros pasos v3 e indicadores del Inicio (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;
  let agA: string;
  let userA: string;
  const status = async (cookie = admA) => {
    const r = await ess.q("a", "setupWizard.status", undefined, cookie);
    expect(r.status).toBe(200);
    return data(r);
  };
  const ok = async (p: Promise<{ status: number; json?: any }>, what: string) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json?.error?.json?.message ?? r.json)}`);
    return data(r as any);
  };
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "pp3");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    agA = await ess.login("a", "agente");
    userA = await ess.login("a", "user");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("empresa nueva: orden de negocio y todos los pasos de hacer pendientes; Inicio a cero, sin cifras inventadas", async () => {
    const st = await status();
    expect(st.plan.steps.map((s: Step) => s.id)).toEqual(["welcome", "company", "fiscal", "activity", "brand", "web", "client", "product", "operation", "document", "comms", "finish"]);
    for (const id of ["brand", "web", "client", "product", "operation", "document", "comms"]) expect(stepOf(st.plan, id)?.status).toBe("pending");
    const ind = await ok(ess.q("a", "coreHome.indicators", undefined, agA), "indicadores");
    expect(ind).toEqual({
      sales: { today: { amount: 0, count: 0 }, month: { amount: 0, count: 0 } },
      unpaidInvoices: { count: 0, amount: 0 },
      awaitingQuotes: { count: 0, amount: 0 },
      newClients: { count: 0 },
      pendingOnlineOrders: { count: 0 },
    });
  });

  it("omitir y retomar: queda omitido en el servidor, otra sesión lo ve igual y al hacerlo de verdad pasa a hecho", async () => {
    await ok(ess.m("a", "setupWizard.setStep", { step: "welcome", status: "done" }, admA), "bienvenida");
    await ok(ess.m("a", "setupWizard.setStep", { step: "client", status: "skipped" }, admA), "omitir cliente");
    // Otra sesión (otro navegador o dispositivo): el mismo progreso, leído del servidor
    const other = await ess.login("a", "admin");
    const st = await status(other);
    expect(stepOf(st.plan, "client")?.status).toBe("skipped");
    expect(st.nextStep).not.toBe("client");
    const [row] = await ess.sql("a", "SELECT value FROM system_settings WHERE `key` = 'setup_wizard_progress'");
    expect(JSON.parse(row.value).steps.client.status).toBe("skipped");
    // Retomarlo: el cliente real lo completa
    await ok(ess.m("a", "crm.clients.create", { name: "Clienta Primera", email: "clienta@primera.example" }, admA), "cliente");
    expect(stepOf((await status(other)).plan, "client")).toMatchObject({ status: "done", byData: true });
  });

  it("un clic en «hecho» no completa la marca, la web ni el correo; los datos reales sí", async () => {
    for (const step of ["brand", "web", "comms", "operation", "document"]) await ok(ess.m("a", "setupWizard.setStep", { step, status: "done" }, admA), `clic ${step}`);
    let st = await status();
    for (const id of ["brand", "web", "comms", "operation", "document"]) expect(stepOf(st.plan, id)?.status).toBe("pending");
    // Correo: guardar sin ningún dato no lo completa; con la dirección de respuesta, sí
    await ok(ess.m("a", "setupWizard.saveComms", {}, admA), "correo vacío");
    expect(stepOf((await status()).plan, "comms")?.status).toBe("pending");
    await ok(ess.m("a", "setupWizard.saveComms", { replyTo: "hola@primera.example" }, admA), "correo");
    // Marca: con el logotipo guardado
    await ok(ess.m("a", "integrations.themeSave", { values: { brand_logo_url: "https://cdn.example/logo-empresa-a.png" } }, admA), "logotipo");
    st = await status();
    expect(stepOf(st.plan, "comms")).toMatchObject({ status: "done", byData: true });
    expect(stepOf(st.plan, "brand")).toMatchObject({ status: "done", byData: true });
  });

  it("primer presupuesto y primera venta son pasos distintos, cada uno con su dato real", async () => {
    const cat = await ok(ess.m("a", "products.createCategory", { slug: "general", name: "General" }, admA), "categoría");
    const loc = await ok(ess.m("a", "products.createLocation", { slug: "principal", name: "Principal" }, admA), "lugar");
    const prod = await ok(ess.m("a", "products.create", { slug: "sesion-asesoria", title: "Sesión de asesoría", categoryId: cat.id, locationId: loc.id, basePrice: "121.00", taxRate: "21", pricingType: "per_unit", isPresentialSale: true }, admA), "producto");
    expect(stepOf((await status()).plan, "product")?.status).toBe("done");
    // Presupuesto en borrador: completa el documento, no la venta
    await ok(
      ess.m("a", "crm.quotes.createDirect", {
        clientName: "Clienta Primera", clientEmail: "clienta@primera.example", title: "Presupuesto para Clienta Primera",
        items: [{ description: "Sesión de asesoría", quantity: 1, unitPrice: 121, total: 121, taxRate: 21, productId: prod.id }],
        subtotal: 100, taxRate: 21, total: 121, sendNow: false,
      }, agA),
      "presupuesto",
    );
    let st = await status();
    expect(stepOf(st.plan, "document")).toMatchObject({ status: "done", byData: true });
    expect(stepOf(st.plan, "operation")?.status).toBe("pending");
    // Pedido cobrado: completa la primera venta
    await ok(
      ess.m("a", "crm.reservations.createManual", {
        customerName: "Clienta Primera", customerEmail: "clienta@primera.example", productId: prod.id, productName: "Sesión de asesoría",
        bookingDate: new Date().toISOString().slice(0, 10), people: 1, amountTotal: 121, amountPaid: 121, paymentMethod: "efectivo", channel: "MANUAL", sendConfirmationEmail: false,
      }, agA),
      "pedido",
    );
    st = await status();
    expect(stepOf(st.plan, "operation")).toMatchObject({ status: "done", byData: true });
    expect(st.facts.sales).toBeGreaterThan(0);
  });

  it("indicadores del Inicio con los datos reales: venta de hoy, factura por cobrar, cliente nuevo; el borrador no cuenta como enviado", async () => {
    await ok(ess.m("a", "crm.invoices.createDirect", { client: { name: "Cliente Puntual" }, lines: [{ description: "Consulta", quantity: 1, unitPrice: 50, taxRate: 21 }] }, agA), "factura");
    const ind = await ok(ess.q("a", "coreHome.indicators", undefined, agA), "indicadores");
    expect(ind.sales.today).toEqual({ amount: 121, count: 1 });
    expect(ind.sales.month).toEqual({ amount: 121, count: 1 });
    // La factura del pedido cobrado no está «por cobrar»; la factura suelta, sí
    expect(ind.unpaidInvoices).toEqual({ count: 1, amount: 60.5 });
    expect(ind.awaitingQuotes).toEqual({ count: 0, amount: 0 });
    expect(ind.newClients.count).toBeGreaterThanOrEqual(1);
    expect(ind.pendingOnlineOrders).toEqual({ count: 0 });
  });

  it("indicadores por licencia y por rol; la otra empresa sigue a cero", async () => {
    await ess.setCapability("a", "bill-invoices", null);
    try {
      const ind = await ok(ess.q("a", "coreHome.indicators", undefined, agA), "sin facturas");
      expect(ind.unpaidInvoices).toBeNull();
      expect(ind.sales).not.toBeNull();
    } finally {
      await ess.setCapability("a", "bill-invoices", "active");
    }
    expect(errCode(await ess.q("a", "coreHome.indicators", undefined, userA))).toBe("FORBIDDEN");
    const b = await ok(ess.q("b", "coreHome.indicators", undefined, admB), "empresa B");
    expect(b.sales.month).toEqual({ amount: 0, count: 0 });
    expect(b.unpaidInvoices.count).toBe(0);
    expect(b.newClients.count).toBe(0);
    const bPlan = data(await ess.q("b", "setupWizard.status", undefined, admB)).plan;
    for (const id of ["client", "product", "operation", "document", "comms", "brand"]) expect(stepOf(bPlan, id)?.status).toBe("pending");
  });

  it("NIF/CIF y código postal españoles comprobados en el servidor; el NIF del registro se acepta; fuera de España, formato general", async () => {
    const fiscal = { legalName: "Empresa A Ejemplo SL", address: "Calle Mayor 1", city: "Madrid", province: "Madrid" };
    const bad = await ess.m("a", "setupWizard.saveFiscal", { ...fiscal, taxId: "B12345678", postalCode: "28001" }, admA);
    expect(errCode(bad)).toBe("BAD_REQUEST");
    expect(bad.json?.error?.json?.message).toMatch(/NIF o CIF no es válido/);
    expect(errCode(await ess.m("a", "setupWizard.saveFiscal", { ...fiscal, taxId: "B12345674", postalCode: "99999" }, admA))).toBe("BAD_REQUEST");
    await ok(ess.m("a", "setupWizard.saveFiscal", { ...fiscal, taxId: "B12345674", postalCode: "28001" }, admA), "fiscal válido");
    // La entidad fiscal registrada (la de las facturas) ya la validó quien la dio de alta
    const st = await status();
    expect(st.fiscalFromRegistry).toBe(true);
    await ok(ess.m("a", "setupWizard.saveFiscal", { ...fiscal, taxId: "B00000011", postalCode: "28001" }, admA), "NIF del registro");
    await ok(ess.m("a", "setupWizard.saveFiscal", { ...fiscal, taxId: "B12345674", postalCode: "28001" }, admA), "fiscal válido otra vez");
    const company = { tradeName: "Empresa A", legalName: "Empresa A Ejemplo SL", taxId: "B12345674", address: "Calle Mayor 1", postalCode: "28001", city: "Madrid", province: "Madrid", country: "ES", currency: "EUR", timezone: "Europe/Madrid" };
    expect(errCode(await ess.m("a", "setupWizard.saveCompany", { ...company, taxId: "12345678A" }, admA))).toBe("BAD_REQUEST");
    await ok(ess.m("b", "setupWizard.saveCompany", { ...company, tradeName: "Empresa B", country: "PT", timezone: "Europe/Lisbon", taxId: "PT123456789", postalCode: "1000-001" }, admB), "empresa portuguesa");
    const rows = await ess.sql("a", "SELECT `key`, value FROM system_settings WHERE `key` IN ('brand_nif','site_legal_zip')");
    expect(Object.fromEntries(rows.map((r) => [r.key, r.value]))).toEqual({ brand_nif: "B12345674", site_legal_zip: "28001" });
  });
});
