import { describe, it, expect, vi } from "vitest";
import { incidentErrorText, recordFiscalIncident, reconcileProposalVersion, canApproveProposal, evaluateAdminGate, listEnabledAdminIds } from "./fiscalIncidents";

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

describe("Reconciliación: separación de funciones (unitarias)", () => {
  const plan = { kind: "issue_invoice", ppId: 1, reservationId: 2, quoteId: 3, amountCents: 40000, paymentMethod: "efectivo" };
  const preview = { invoicesToIssue: 1, invoiceAmountCents: 40000, reservationsLinked: 1, reservationsCreated: 0, documentNumbersConsumed: 1, historicalDocumentsModified: 0 };
  it("la versión es estable (independiente del orden de claves) y cambia si cambia plan, motivo o vista previa", () => {
    const v = reconcileProposalVersion({ plan, reason: "motivo suficiente", preview });
    expect(v).toMatch(/^[0-9a-f]{16}$/);
    expect(reconcileProposalVersion({ preview, reason: "motivo suficiente", plan: { paymentMethod: "efectivo", amountCents: 40000, quoteId: 3, reservationId: 2, ppId: 1, kind: "issue_invoice" } })).toBe(v);
    expect(reconcileProposalVersion({ plan: { ...plan, amountCents: 40001 }, reason: "motivo suficiente", preview })).not.toBe(v);
    expect(reconcileProposalVersion({ plan, reason: "otro motivo", preview })).not.toBe(v);
    expect(reconcileProposalVersion({ plan, reason: "motivo suficiente", preview: { ...preview, invoiceAmountCents: 1 } })).not.toBe(v);
  });
  it("solo aprueba un usuario identificado y distinto del proponente", () => {
    expect(canApproveProposal(1, 2)).toBe(true);
    expect(canApproveProposal(1, 1)).toBe(false);
    expect(canApproveProposal(null, 2)).toBe(false);
    expect(canApproveProposal(1, null)).toBe(false);
    expect(canApproveProposal(1, undefined)).toBe(false);
  });
});

describe('Reconciliación: dos administradores habilitados (unitarias)', () => {
  it('proponer exige otro administrador habilitado distinto del proponente', () => {
    expect(evaluateAdminGate('propose', [1], 1)).toBe('no_second_admin');
    expect(evaluateAdminGate('propose', [], 1)).toBe('no_second_admin');
    expect(evaluateAdminGate('propose', [1, 2], 1)).toBe('ok');
    expect(evaluateAdminGate('propose', [2], 1)).toBe('ok');
  });
  it('aprobar exige dos o más administradores habilitados y que el aprobador sea uno de ellos', () => {
    expect(evaluateAdminGate('approve', [2], 2)).toBe('no_second_admin');
    expect(evaluateAdminGate('approve', [1, 2], 2)).toBe('ok');
    expect(evaluateAdminGate('approve', [1, 3], 2)).toBe('approver_not_enabled');
  });
  it('aplicar exige que el aprobador registrado siga habilitado (y siga habiendo dos)', () => {
    expect(evaluateAdminGate('apply', [1, 3], 1, 2)).toBe('approver_not_enabled');
    expect(evaluateAdminGate('apply', [1, 2], 1, 2)).toBe('ok');
    expect(evaluateAdminGate('apply', [1, 2], 1, null)).toBe('approver_not_enabled');
    expect(evaluateAdminGate('apply', [1], 1, 1)).toBe('no_second_admin');
  });
  it('listEnabledAdminIds devuelve los ids numéricos de la consulta', async () => {
    const where = vi.fn().mockResolvedValue([{ id: 1 }, { id: '2' }]);
    const runner = { select: () => ({ from: () => ({ where }) }) };
    expect(await listEnabledAdminIds(runner)).toEqual([1, 2]);
    expect(where).toHaveBeenCalledTimes(1);
  });
});
