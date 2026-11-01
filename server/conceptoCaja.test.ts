/**
 * Concepto de los cobros de caja en contabilidad: «Venta en caja …» en los cobros nuevos. Los asientos ya escritos
 * no se tocan (no hay ninguna actualización de los existentes).
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("./_core/legacyDb", () => ({ legacyDb: () => ({}), legacyPool: () => ({}) }));
vi.mock("./mailer", () => ({ sendEmail: vi.fn() }));

const { cashSaleConcept } = await import("./routers/tpv");

describe("concepto de los cobros de caja", () => {
  it("«Venta en caja» con el ticket y, si lo hay, el producto principal", () => {
    expect(cashSaleConcept("T-2026-0001", "Revisión anual")).toBe("Venta en caja T-2026-0001 — Revisión anual");
    expect(cashSaleConcept("T-2026-0002")).toBe("Venta en caja T-2026-0002");
    expect(cashSaleConcept("T-2026-0003", null)).toBe("Venta en caja T-2026-0003");
  });

  it("los dos cobros de la caja (venta y venta con pedido) lo usan; nada reescribe los asientos ya escritos", () => {
    const src = fs.readFileSync(path.join(__dirname, "routers/tpv.ts"), "utf8");
    expect(src.split("description: cashSaleConcept(ticketNumber, mainItem?.productName)").length - 1).toBe(2);
    expect(src).not.toContain("`Venta TPV ");
    expect(src).not.toMatch(/update\(transactions\)[\s\S]{0,200}Venta en caja/);
  });
});
