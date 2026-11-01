/**
 * Propuestas comerciales con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): como los
 * presupuestos, una propuesta no se envía con un producto del catálogo a 0,00 € (en ninguna de sus opciones).
 * El borrador se sigue guardando. Solo empresas sintéticas nuevas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Propuestas: no se envían con productos sin precio", () => {
  let ess: EssentialApp;
  let agA: string;
  let leadId = 0;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "propprecio");
    agA = await ess.login("a", "agente");
    const r = await ess.m("a", "crm.quotes.createDirect", { clientName: "Cliente Propuesta", clientEmail: "propuesta@cliente-a.example", title: "Base", items: [{ description: "Servicio", quantity: 1, unitPrice: 10, total: 10 }], subtotal: 10, total: 12.1, pricesIncludeTax: false }, agA);
    leadId = data(r).leadId;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  const item = (o: Record<string, unknown>) => ({ description: "Revisión anual", quantity: 1, unitPrice: 0, total: 0, productId: 7, ...o });

  it("producto del catálogo a 0 €: el borrador se guarda, el envío se rechaza y no sale ningún correo", async () => {
    const p = await ess.m("a", "proposals.create", { leadId, title: "Con producto sin precio", items: [item({})] }, agA);
    expect(p.status).toBe(200);
    const id = (await ess.sql("a", "SELECT id FROM proposals ORDER BY id DESC LIMIT 1"))[0].id;
    const mails = ess.mails.length;
    const r = await ess.m("a", "proposals.send", { id }, agA);
    expect(errCode(r)).toBe("PRECONDITION_FAILED");
    expect(r.json.error.json.message).toMatch(/«Revisión anual»/);
    expect(ess.mails.length).toBe(mails);
    expect((await ess.sql("a", "SELECT status FROM proposals WHERE id = ?", [id]))[0].status).not.toBe("enviado");
  });

  it("multiopción: basta una opción con un producto a 0 € para no enviarla; con precio o línea libre, sí", async () => {
    await ess.m("a", "proposals.create", {
      leadId, title: "Dos opciones", mode: "multi_option",
      options: [
        { title: "Básica", items: [item({ unitPrice: 50, total: 50 })], total: 50 },
        { title: "Completa", items: [item({ description: "Extra sin precio" })], total: 0 },
      ],
    }, agA);
    const multi = (await ess.sql("a", "SELECT id FROM proposals ORDER BY id DESC LIMIT 1"))[0].id;
    expect(errCode(await ess.m("a", "proposals.send", { id: multi }, agA))).toBe("PRECONDITION_FAILED");

    await ess.m("a", "proposals.create", { leadId, title: "Con precio", items: [item({ unitPrice: 80, total: 80 }), { description: "Regalo", quantity: 1, unitPrice: 0, total: 0 }] }, agA);
    const ok = (await ess.sql("a", "SELECT id FROM proposals ORDER BY id DESC LIMIT 1"))[0].id;
    expect((await ess.m("a", "proposals.send", { id: ok }, agA)).status).toBe(200);
  });
});
