/**
 * Envío de presupuestos con productos a 0 € con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 * Adaptado de Skicenter (1b89f9c8). Empresa nueva desde la baseline; rol comercial (agente). No se envía ningún
 * correo: todos los envíos de esta prueba se rechazan antes de enviar.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("presupuestos: no se envían con productos a 0 €", () => {
  let ess: EssentialApp;
  let ag: string;
  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "presucero");
    ag = await ess.login("a", "agente");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  const base = { clientName: "Cliente Cero", clientEmail: "cero@cliente-a.example", title: "Presupuesto de prueba", subtotal: 0, total: 0 };
  const zeroLine = { description: "Curso sin precio", quantity: 1, unitPrice: 0, total: 0, productId: 999999 };

  it("crear y enviar con un producto a 0 € se rechaza sin crear nada", async () => {
    const r = await ess.m("a", "crm.quotes.createDirect", { ...base, items: [zeroLine], sendNow: true }, ag);
    expect(errCode(r)).toBe("PRECONDITION_FAILED");
    expect(JSON.stringify(r.json)).toContain("Curso sin precio");
    expect((await ess.sql("a", "SELECT COUNT(*) AS n FROM quotes"))[0].n).toBe(0);
  });

  it("el borrador se guarda, pero enviarlo y reenviarlo se rechaza", async () => {
    const r = await ess.m("a", "crm.quotes.createDirect", { ...base, items: [zeroLine] }, ag);
    expect(r.status).toBe(200);
    const id = data(r).quoteId;
    expect(errCode(await ess.m("a", "crm.quotes.send", { id }, ag))).toBe("PRECONDITION_FAILED");
    expect(errCode(await ess.m("a", "crm.quotes.resend", { id }, ag))).toBe("PRECONDITION_FAILED");
    const [q] = await ess.sql("a", "SELECT status, sentAt FROM quotes WHERE id = ?", [id]);
    expect(q).toMatchObject({ status: "borrador", sentAt: null });
  });
});
