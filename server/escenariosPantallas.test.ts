/**
 * Fallos de usuario nuevo encontrados en los escenarios v2 (server/escenarios.v2.e2e.mysql.test.ts), fijados en las
 * pantallas que los causaban:
 *  - el primer producto creado en «Primeros pasos» no aparecía en el TPV (se creaba sin «Vendible en TPV»);
 *  - el TPV vacío pedía marcar una opción con un nombre que no existe en la ficha del producto;
 *  - al enviar un presupuesto en la prueba gratuita se decía «enviado al cliente» aunque el correo no salía.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

describe("pantallas de un usuario nuevo", () => {
  it("el producto del asistente se crea vendible en el TPV", () => {
    const src = read("client/src/pages/admin/setup/PrimerosPasosSteps.tsx");
    const call = src.slice(src.indexOf("createProduct.mutateAsync({"), src.indexOf("});", src.indexOf("createProduct.mutateAsync({")));
    expect(call).toContain("isPresentialSale: true");
  });

  it("el TPV vacío nombra la opción tal como aparece en la ficha del producto", () => {
    expect(read("client/src/pages/admin/products/ExperiencesManager.tsx")).toContain("Vendible en TPV");
    const tpv = read("client/src/pages/admin/tpv/TpvScreen.tsx");
    expect(tpv).toContain("«Vendible en TPV»");
    expect(tpv).not.toContain("«venta presencial»");
  });

  it("CRM: las rutas directas abren su pestaña y los avisos bancarios solo se piden con su licencia", () => {
    const crm = read("client/src/pages/admin/crm/CRMDashboard.tsx");
    expect(crm).toContain('{ "/admin/crm/presupuestos": "quotes", "/admin/crm/reservas": "reservations" }');
    const bank = crm.slice(crm.indexOf("const bankLicensed"), crm.indexOf("const deleteAnulMutation"));
    expect(bank).toContain('panelSub.can("bank-import-pos")');
    expect(bank.match(/enabled: bankLicensed/g)?.length).toBe(2);
  });

  it("clientes: sin la palabra «lead» a la vista de una pyme (vocabulario de oportunidades)", () => {
    const src = read("client/src/pages/admin/crm/ClientsManager.tsx");
    expect(src).not.toMatch(/>\s*(Desde lead|Lead origen)\s*</);
    expect(src).not.toMatch(/\/> Lead #|>Lead #/);
    expect(src).toContain("{voc.leadOrigin}");
  });

  it("enviar o reenviar un presupuesto muestra lo que ha pasado con el correo, nunca un «enviado» fijo", () => {
    const crm = read("client/src/pages/admin/crm/CRMDashboard.tsx");
    expect(crm).not.toMatch(/toast\.success\("Presupuesto (enviado|reenviado)/);
    expect(crm.match(/toastQuoteMail\(data, /g)?.length).toBe(6);
    const router = read("server/routers/crm.ts");
    expect(router).toContain("return { success: true, acceptUrl, token, ...mail };");
    expect(router).toContain("acceptUrl: paymentLinkUrl ?? null, ...mail };");
  });
});
