/**
 * Facturas emitidas: el listado no ofrece «Eliminar factura» (el servidor lo rechaza siempre: no hay borradores) ni
 * un diálogo que prometa borrarla para siempre; la vía para corregirla es «Emitir abono» o «Anular».
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../client/src/pages/admin/crm/CRMDashboard.tsx"), "utf8");
const router = fs.readFileSync(path.resolve(__dirname, "routers/crm.ts"), "utf8");

describe("acciones de las facturas emitidas", () => {
  it("sin acción ni diálogo de borrado", () => {
    expect(src).not.toContain("Eliminar factura");
    expect(src).not.toContain("crm.invoices.delete");
    expect(src).not.toMatch(/deleteInvoice/);
    expect(src).not.toMatch(/eliminará la factura permanentemente/);
  });

  it("se mantienen «Emitir abono» y «Anular factura»", () => {
    expect(src).toContain('title="Emitir abono"');
    expect(src).toContain('title="Anular factura"');
  });

  it("el servidor sigue rechazando el borrado de facturas emitidas", () => {
    expect(router).toContain("Las facturas emitidas no se pueden borrar");
  });
});
