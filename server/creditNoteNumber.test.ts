import { describe, it, expect } from "vitest";
import { creditNotePrefix, formatCreditNoteNumber, isDeadlock, isDuplicateInvoiceNumber, withCreditNoteNumberRetry } from "./creditNoteNumber";

describe("numeración de abonos (serie vigente ABO)", () => {
  it("conserva el formato ABO-AAAA-MM-nnnn", () => {
    const d = new Date(2026, 2, 5);
    expect(creditNotePrefix(d)).toBe("ABO-2026-03-");
    expect(formatCreditNoteNumber(d, 7)).toBe("ABO-2026-03-0007");
    expect(formatCreditNoteNumber(d, 12345)).toBe("ABO-2026-03-12345");
  });

  it("solo la clave duplicada del número de factura se reintenta", () => {
    const dup = { code: "ER_DUP_ENTRY", errno: 1062, sqlMessage: "Duplicate entry 'ABO-2026-03-0001' for key 'invoices.invoices_invoiceNumber_unique'" };
    expect(isDuplicateInvoiceNumber(dup)).toBe(true);
    expect(isDuplicateInvoiceNumber(new Error("envoltorio", { cause: dup }))).toBe(true);
    expect(isDuplicateInvoiceNumber({ code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry 'x' for key 'otra_clave'" })).toBe(false);
    expect(isDuplicateInvoiceNumber(new Error("BAD_REQUEST"))).toBe(false);
    expect(isDeadlock(new Error("envoltorio", { cause: { code: "ER_LOCK_DEADLOCK", errno: 1213 } }))).toBe(true);
    expect(isDeadlock(new Error("otro"))).toBe(false);
  });

  it("reintenta ante un número duplicado y no ante otros errores", async () => {
    const dup = { code: "ER_DUP_ENTRY", sqlMessage: "for key 'invoices_invoiceNumber_unique'" };
    let calls = 0;
    await expect(withCreditNoteNumberRetry(async () => { if (++calls < 3) throw dup; return "ok"; })).resolves.toBe("ok");
    expect(calls).toBe(3);
    calls = 0;
    await expect(withCreditNoteNumberRetry(async () => { calls++; throw new Error("otro"); })).rejects.toThrow("otro");
    expect(calls).toBe(1);
    calls = 0;
    await expect(withCreditNoteNumberRetry(async () => { calls++; throw dup; }, 4)).rejects.toBe(dup);
    expect(calls).toBe(4);
  });
});
