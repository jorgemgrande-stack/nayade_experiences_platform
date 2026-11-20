import { describe, expect, it } from "vitest";
import { extraTemplates } from "../mail/extraTemplates";

const base = { companyName: "Cliente S.L.", signerName: "Marta", reference: "CT-2026-000014", version: 1, packageName: null, services: ["Essential"], lines: null, netCents: 4500, taxes: [{ label: "IVA (21 %)", cents: 945 }], totalCents: 5445, period: "mensual" as const, oneTime: [], currency: "EUR", url: "https://admin.example/cp/v1/public/contract-acceptance/condiciones?token=T", expiresAt: 1_800_000_000_000 };
const html = (i: Parameters<typeof extraTemplates.termsInvitation>[0]) => JSON.stringify(extraTemplates.termsInvitation(i));

describe("correo del contrato: botón según el cobro", () => {
  it("con el cobro habilitado el botón es «Aceptar y pagar» y avisa de que se paga en Stripe tras aceptar", () => {
    const m = html({ ...base, payable: true });
    expect(m).toContain("Aceptar y pagar");
    expect(m).toContain("página segura de Stripe");
    expect(m).not.toContain("Revisar y aceptar contrato");
  });
  it("sin cobro habilitado no promete un pago: «Revisar y aceptar contrato» y «no realiza ningún cobro»", () => {
    const m = html(base);
    expect(m).toContain("Revisar y aceptar contrato");
    expect(m).toContain("no realiza ningún cobro");
    expect(m).not.toContain("Aceptar y pagar");
  });
});
