/**
 * Rectificativas (art. 15 RD 1619/2012) y libro registro de facturas expedidas.
 *  - Total: todas las líneas en negativo; al expedirse, la original queda «rectificada». Parcial: una base menor con un
 *    único tipo de IVA; la original sigue vigente. Serie propia (EBR), cliente de la original, misma fecha de operación.
 *  - Solo se rectifica una factura expedida y vigente; con motivo; idempotente por importe.
 *  - Libro registro: solo lo expedido, por fecha de expedición, una fila por tipo de IVA, formato de hoja española.
 */
import { describe, it, expect } from "vitest";
import { chargeInstant } from "../external/schedule";
import type { ExternalSubscription } from "../external/types";
import { registerCsv } from "./register";
import type { CompanyFiscal } from "./rules";
import { InvoicingService } from "./service";
import { MemoryInvoicingStore } from "./store";
import type { FiscalParty } from "./types";

const TZ = "Europe/Madrid";
const FIRST = chargeInstant("2026-11-01", 8, TZ);
const ISSUER: FiscalParty = { legalName: "IRON ELEPHANT CONSULTING, S.L.", taxId: "B26987875", address: "Calle Corazón de María, 57, 1.º D", postalCode: "28002", city: "Madrid", country: "ES" };
const NEXTAIR: CompanyFiscal = { name: "Nextair", legalName: "NEXTAIR SL", taxId: "B16408031", address: "C/ José Luis Pérez Pujadas, Ed. Forum, 14, 1º D", postalCode: "18006", city: "Granada", country: "ES" };

async function issuedNovember() {
  const store = new MemoryInvoicingStore();
  let now = FIRST;
  const x = { id: 1, companyId: 7, serviceName: "SkiNet — Servicio tecnológico gestionado", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, billingDay: 1, billingHour: 8, timezone: TZ, firstChargeAt: FIRST, externalRef: null, status: "active" } as unknown as ExternalSubscription;
  const svc = new InvoicingService({ store, external: { list: async () => [x], events: async () => [] }, company: async () => NEXTAIR, issuer: ISSUER, seriesCode: "EB", issueEnabled: true, now: () => now });
  await svc.generateExternal("op");
  now = chargeInstant("2026-11-03", 10, TZ);
  const inv = await svc.issue(1, "operator:jorge");
  return { svc, store, inv, at: (t: number) => (now = t) };
}

describe("rectificativas", () => {
  it("total: líneas en negativo, serie EBR, cliente y fecha de operación de la original; al expedirla, la original queda rectificada", async () => {
    const { svc, inv } = await issuedNovember();
    expect(inv.number).toBe("EB-2026-00001");
    const r = await svc.rectify(inv.id, { reason: "Servicio no prestado en noviembre" }, "operator:jorge");
    expect(r).toMatchObject({ kind: "rectification", status: "draft", originalInvoiceId: inv.id, operationDate: "2026-11-01", baseCents: -100_000, taxCents: -21_000, totalCents: -121_000, customer: { taxId: "B16408031" } });
    expect(r.notes).toBe("Rectifica la factura EB-2026-00001 de 2026-11-03. Motivo: Servicio no prestado en noviembre");
    expect(r.lines[0].concept).toBe("Rectificación: SkiNet — Servicio tecnológico gestionado — noviembre de 2026");
    // Idempotente por importe
    expect((await svc.rectify(inv.id, { reason: "otra vez" }, "op")).id).toBe(r.id);
    const issued = await svc.issue(r.id, "operator:jorge");
    expect(issued).toMatchObject({ number: "EBR-2026-00001", status: "issued" });
    expect((await svc.must(inv.id)).status).toBe("rectified");
    await expect(svc.rectify(inv.id, { reason: "de nuevo" }, "op")).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("parcial: una base menor, la original sigue vigente", async () => {
    const { svc, inv } = await issuedNovember();
    const r = await svc.rectify(inv.id, { reason: "Descuento pactado de 200 €", baseCents: 20_000 }, "op");
    expect(r).toMatchObject({ baseCents: -20_000, taxCents: -4200, totalCents: -24_200 });
    expect(r.lines).toEqual([{ position: 1, concept: "Rectificación parcial de la factura EB-2026-00001", quantity: 1, unitCents: -20_000, baseCents: -20_000, taxRateBp: 2100, taxCents: -4200 }]);
    await svc.issue(r.id, "op");
    expect((await svc.must(inv.id)).status).toBe("issued");
  });

  it("solo expedidas, con motivo y con una base válida", async () => {
    const { svc, inv } = await issuedNovember();
    await expect(svc.rectify(inv.id, { reason: "x" }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.rectify(inv.id, { reason: "Exceso", baseCents: 200_000 }, "op")).rejects.toMatchObject({ code: "invalid_input" });
    const r = await svc.rectify(inv.id, { reason: "Error de importe" }, "op");
    await expect(svc.rectify(r.id, { reason: "rectificar una rectificativa" }, "op")).rejects.toMatchObject({ code: "invalid_state" });
  });
});

describe("libro registro de facturas expedidas", () => {
  it("solo lo expedido, por fecha de expedición, F1 y R1 con la factura rectificada, formato español", async () => {
    const { svc, store } = await issuedNovember();
    const r = await svc.rectify(1, { reason: "Descuento", baseCents: 20_000 }, "op");
    await svc.issue(r.id, "op");
    const csv = registerCsv(store.rows);
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("Fecha de expedición;Fecha de operación;Serie;Número;Tipo;NIF del destinatario;Nombre o razón social;Base imponible;Tipo de IVA (%);Cuota de IVA;Total de la factura;Factura rectificada;Estado de cobro");
    expect(lines.slice(1)).toEqual([
      "03/11/2026;01/11/2026;EB;EB-2026-00001;F1;B16408031;NEXTAIR SL;1000,00;21,00;210,00;1210,00;;Pendiente",
      "03/11/2026;01/11/2026;EBR;EBR-2026-00001;R1;B16408031;NEXTAIR SL;-200,00;21,00;-42,00;-242,00;EB-2026-00001;Pendiente",
    ]);
    // Los borradores no figuran
    await svc.rectify(1, { reason: "Otro", baseCents: 10_000 }, "op");
    expect(registerCsv(store.rows).trim().split("\r\n")).toHaveLength(3);
  });

  it("sin fórmulas ni separadores sueltos en los nombres", () => {
    const inv = { id: 1, number: "EB-2026-00009", seriesCode: "EB", issueDate: "2026-12-01", operationDate: "2026-12-01", status: "issued", kind: "invoice", paymentStatus: "paid", totalCents: 121, originalInvoiceId: null, customer: { legalName: '=HYPERLINK("x");"A"', taxId: "B26987875" }, lines: [{ position: 1, concept: "c", quantity: 1, unitCents: 100, baseCents: 100, taxRateBp: 2100, taxCents: 21 }] } as never;
    expect(registerCsv([inv])).toContain(`"'=HYPERLINK(""x"");""A"""`);
  });
});
