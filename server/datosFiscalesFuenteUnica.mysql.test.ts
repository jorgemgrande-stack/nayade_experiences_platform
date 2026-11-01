/**
 * Datos fiscales de una pyme con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL).
 *
 * Una empresa sin entidad fiscal en el registro guarda sus datos en el asistente / «Datos de la empresa», pero su base
 * conserva ajustes antiguos `legalCompany*`. Las facturas nuevas usan lo del asistente; las emitidas antes del cambio
 * (migración 0018) se siguen viendo exactamente como se emitieron. Con entidad fiscal, el contacto e IBAN también
 * salen del asistente. Solo empresas sintéticas nuevas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { startEssentialApp, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;

describe.skipIf(!URL_)("Datos fiscales: fuente única del asistente en documentos nuevos (dos empresas)", () => {
  let ess: EssentialApp;
  let admA: string;
  let admB: string;

  const company = (o: Record<string, string>) => ({ tradeName: "Taller Nuevo", legalName: "Taller Nuevo SL", taxId: "B12345678", address: "Calle Nueva 1", postalCode: "28001", city: "Madrid", province: "Madrid", country: "ES", currency: "EUR", timezone: "Europe/Madrid", ...o });
  const legacy = async (co: "a" | "b", kv: Record<string, string>) => {
    for (const [k, v] of Object.entries(kv)) {
      await ess.sql(co, "INSERT INTO site_settings (`key`, value, type, updatedAt) VALUES (?, ?, 'text', NOW()) ON DUPLICATE KEY UPDATE value = VALUES(value)", [k, v]);
    }
  };
  const invoice = async (co: "a" | "b", n: string, issuedAt: string) => {
    await ess.sql(co, "INSERT INTO invoices (invoiceNumber, clientName, clientEmail, itemsJson, subtotal, taxRate, taxAmount, total, status, issuedAt) VALUES (?, 'Cliente', 'cliente@prueba.example', ?, 100, 21, 21, 121, 'generada', ?)", [n, JSON.stringify([{ description: "Servicio", quantity: 1, unitPrice: 100, total: 100, taxRate: 21 }]), issuedAt]);
  };
  const preview = async (co: "a" | "b", n: string, cookie: string) => {
    const r = await ess.call(co, "GET", `/api/invoices/preview?n=${encodeURIComponent(n)}`, { cookie });
    expect(r.status).toBe(200);
    return r.text;
  };

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "fiscalfuente");
    admA = await ess.login("a", "admin");
    admB = await ess.login("b", "admin");
    // B: alta autoservicio sin entidad fiscal en el registro
    const reg = await mysql.createConnection({ uri: process.env.REGISTRY_DATABASE_URL! });
    await reg.query("DELETE FROM tenant_fiscal_entities WHERE tenant_id = ?", [ess.ids.b]);
    await reg.end();
    ess.refreshTenant("b");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin entidad fiscal: la factura nueva lleva los datos del asistente; la emitida antes, los de entonces", async () => {
    await legacy("b", { legalCompanyName: "Antigua Razón SL", legalCompanyCif: "B99999999", legalCompanyAddress: "Calle Vieja 9", legalCompanyIban: "ES00 VIEJO" });
    const r = await ess.m("b", "setupWizard.saveCompany", company({}), admB);
    expect(r.status).toBe(200);
    await ess.sql("b", "INSERT INTO system_settings (`key`, value, category, label) VALUES ('site_legal_iban', 'ES11 NUEVO', 'fiscal', 'IBAN') ON DUPLICATE KEY UPDATE value = VALUES(value)");

    await invoice("b", "FAC-NUEVA-0001", new Date().toISOString().slice(0, 19).replace("T", " "));
    await invoice("b", "FAC-VIEJA-0001", "2020-03-01 10:00:00");

    const nueva = await preview("b", "FAC-NUEVA-0001", admB);
    expect(nueva).toContain("Taller Nuevo SL");
    expect(nueva).toContain("CIF: B12345678");
    expect(nueva).toContain("Calle Nueva 1");
    expect(nueva).toContain("ES11 NUEVO");
    expect(nueva).not.toMatch(/Antigua Razón|B99999999|ES00 VIEJO/);

    // Emitida antes del cambio: idéntica a como se emitió (los ajustes antiguos primero)
    const vieja = await preview("b", "FAC-VIEJA-0001", admB);
    expect(vieja).toContain("Antigua Razón SL");
    expect(vieja).toContain("CIF: B99999999");
    expect(vieja).not.toContain("Taller Nuevo SL");
  });

  it("con entidad fiscal: emisor del registro y el IBAN del asistente; nada de la otra empresa", async () => {
    await legacy("a", { legalCompanyName: "Antigua A SL", legalCompanyIban: "ES00 VIEJO A" });
    await ess.sql("a", "INSERT INTO system_settings (`key`, value, category, label) VALUES ('site_legal_iban', 'ES22 NUEVO A', 'fiscal', 'IBAN') ON DUPLICATE KEY UPDATE value = VALUES(value)");
    await invoice("a", "FAC-A-0001", new Date().toISOString().slice(0, 19).replace("T", " "));
    const html = await preview("a", "FAC-A-0001", admA);
    expect(html).toContain("Empresa A Ejemplo SL");
    expect(html).toContain("CIF: B00000011");
    expect(html).toContain("ES22 NUEVO A");
    expect(html).not.toMatch(/Antigua A SL|ES00 VIEJO A|Taller Nuevo|ES11 NUEVO/);
    // B no ve la factura de A
    expect((await ess.call("b", "GET", `/api/invoices/preview?n=FAC-A-0001`, { cookie: admB })).status).toBe(404);
  });
});
