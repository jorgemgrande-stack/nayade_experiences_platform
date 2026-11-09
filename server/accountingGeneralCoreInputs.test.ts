/**
 * Contabilidad general — lo que el Core guarda para ella: el desglose de IVA de un gasto (expenses.create/update). Sin BD.
 */
import { describe, expect, it } from "vitest";
import { computeExpenseFiscal } from "./routers/expenses";

describe("desglose de IVA de un gasto: solo «revisado» si se confirma", () => {
  it("sin tipo de IVA no se supone un 21 %: sin desglose y pendiente", () => {
    expect(computeExpenseFiscal({ amount: "121.00" })).toMatchObject({ taxBase: null, taxAmount: null, fiscalReviewStatus: "pendiente" });
    expect(computeExpenseFiscal({ amount: "121.00" })).not.toHaveProperty("taxRate");
    expect(computeExpenseFiscal({ amount: "121.00", taxRate: "", taxReviewed: true })).toMatchObject({ taxAmount: null, fiscalReviewStatus: "pendiente" });
  });
  it("con tipo pero sin confirmarlo: el desglose se guarda, pendiente de revisar", () => {
    expect(computeExpenseFiscal({ amount: "121.00", taxRate: "21" })).toMatchObject({ taxBase: "100", taxAmount: "21", fiscalReviewStatus: "pendiente" });
  });
  it("confirmado con un tipo de factura que deduce: revisado", () => {
    expect(computeExpenseFiscal({ amount: "110.00", taxRate: "10", invoiceType: "ordinaria", taxReviewed: true })).toMatchObject({ taxRate: "10", taxAmount: "10", fiscalReviewStatus: "revisado" });
    expect(computeExpenseFiscal({ amount: "121.00", taxRate: "21", taxReviewed: true }).fiscalReviewStatus).toBe("revisado");
  });
  it("sin factura o exenta nunca quedan revisadas (nunca deducen)", () => {
    for (const invoiceType of ["sin_factura", "exenta"]) {
      expect(computeExpenseFiscal({ amount: "121.00", taxRate: "21", invoiceType, taxReviewed: true }).fiscalReviewStatus).toBe("pendiente");
    }
  });
});

