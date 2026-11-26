import { describe, it, expect, vi } from "vitest";
import { incidentErrorText, recordFiscalIncident } from "./fiscalIncidents";

describe("Incidencias fiscales (registro)", () => {
  it("el texto del error es corto, de una línea y sin trazas", () => {
    const e = new Error("fallo\n  at algo (fichero.ts:1:1)\n".repeat(50));
    const t = incidentErrorText(e);
    expect(t.length).toBeLessThanOrEqual(200);
    expect(t).not.toMatch(/\n/);
  });
  it("registra con la marca incident y los datos recibidos", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const runner = { insert: vi.fn(() => ({ values })) };
    await recordFiscalIncident(runner, "quote", 7, "installment_plan_failed", { id: null, name: "Sistema (Redsys)" }, { installmentId: 3 });
    const row = values.mock.calls[0][0];
    expect(row).toMatchObject({ entityType: "quote", entityId: 7, action: "installment_plan_failed", actorName: "Sistema (Redsys)" });
    expect(row.details).toMatchObject({ incident: true, installmentId: 3 });
  });
  it("si el propio registro falla no rompe el flujo del cobro", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runner = { insert: () => ({ values: () => Promise.reject(new Error("BD caída")) }) };
    await expect(recordFiscalIncident(runner, "quote", 1, "payment_confirmed_without_invoice", { id: 1, name: "x" }, {})).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
