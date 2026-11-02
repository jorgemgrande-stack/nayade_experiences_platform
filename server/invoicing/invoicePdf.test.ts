/**
 * Las facturas se descargan como PDF AUTÉNTICO (pdf-lib, cabecera «%PDF-», `application/pdf`), nunca como el documento
 * HTML renombrado: factura de 1.000 € + 21 % IVA, varias páginas con texto en español y rectificativa con la referencia
 * de la factura que rectifica. Datos SINTÉTICOS.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PDFDocument } from "pdf-lib";
import { authenticate, hashToken } from "../controlPlane/auth";
import { chargeInstant } from "../external/schedule";
import type { ExternalEvent, ExternalSubscription } from "../external/types";
import { ISSUER } from "../stripe/issuer";
import { createInvoicingRouter } from "./api";
import { InvoicingAutomation, invoicePdfBlocks, rectifiedOf, renderInvoicePdf } from "./delivery";
import type { CompanyFiscal } from "./rules";
import { InvoicingService } from "./service";
import { MemoryInvoicingStore } from "./store";
import type { FiscalParty, Invoice } from "./types";

const TZ = "Europe/Madrid";
const NOV = chargeInstant("2026-11-01", 8, TZ);
const ISSUER_PARTY: FiscalParty = { legalName: ISSUER.legalName, taxId: ISSUER.taxId, address: `${ISSUER.address.line1}, ${ISSUER.address.line2}`, postalCode: ISSUER.address.postalCode, city: ISSUER.address.city, country: "ES" };
const CLIENT: CompanyFiscal = { name: "Cliente", legalName: "CLIENTE SINTÉTICO SL", taxId: "B12345674", address: "Calle Ejemplo 1", postalCode: "18006", city: "Granada", country: "ES", billingEmail: "facturas@cliente.example" };
const TOKEN = "ci-only-placeholder-not-a-secret-invoicing-pdf";
const isPdf = (b: Uint8Array | Buffer) => Buffer.from(b).subarray(0, 5).toString("latin1") === "%PDF-";

async function issued() {
  const store = new MemoryInvoicingStore();
  const xs = [{ id: 1, contractId: 9, companyId: 7, serviceKey: "svc", serviceName: "Servicio gestionado", amountCents: 100_000, currency: "EUR", taxRateBp: 2100, interval: "month", billingDay: 1, billingHour: 8, timezone: TZ, graceDays: 5, firstChargeAt: NOV, externalRef: null, status: "active", endsAt: null } as ExternalSubscription];
  const events: ExternalEvent[] = [{ id: 0, externalId: 1, kind: "invoice_paid", ref: "in_nov", detail: { periodStart: NOV, baseCents: 100_000, taxCents: 21_000, totalCents: 121_000, paymentRef: "stripe:in:in_nov" }, actor: "system:stripe", at: NOV + 3_700_000 }];
  const now = NOV + 3_800_000;
  const svc = new InvoicingService({ store, external: { list: async () => xs, events: async () => events }, company: async () => CLIENT, issuer: ISSUER_PARTY, seriesCode: "EB", issueEnabled: true, proformaLeadDays: 5, now: () => now });
  const auto = new InvoicingAutomation({ svc, store, issueEnabled: true, stripeInvoice: async () => ({ status: "paid", amountPaid: 121_000, currency: "EUR" }), now: () => now });
  await svc.generateExternal("system");
  await auto.issueDue();
  const inv = (await store.list({ status: "issued" }))[0];
  return { store, svc, inv };
}

describe("PDF auténtico de las facturas", () => {
  it("factura de 1.000 € + 21 %: PDF válido que se abre, con número, base, cuota y total exactos", async () => {
    const { inv } = await issued();
    expect(inv).toMatchObject({ number: "EB-2026-00001", baseCents: 100_000, taxCents: 21_000, totalCents: 121_000 });
    const pdf = await renderInvoicePdf(inv, ISSUER_PARTY);
    expect(isPdf(pdf)).toBe(true);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
    const text = JSON.stringify(invoicePdfBlocks(inv, ISSUER_PARTY)).replace(/[  ]/g, " ");
    for (const s of ["EB-2026-00001", "1.000,00 €", "210,00 €", "1.210,00 €", "21 %", ISSUER.taxId, "B12345674", "CLIENTE SINTÉTICO SL", "Fecha de expedición", "Fecha de operación"]) expect(text).toContain(s);
  });

  it("muchas líneas y conceptos largos en español: varias páginas, sin fallar por ningún carácter", async () => {
    const { inv } = await issued();
    const long = "Servicio de consultoría tecnológica: diseño, migración y soporte ¿incluido? ¡Sí! — año 2026, nº 5, 1.ª fase · «Ñandú» Pingüino €";
    const big: Invoice = { ...inv, lines: Array.from({ length: 90 }, (_, k) => ({ ...inv.lines[0], concept: `${long} (${k + 1}) ${"x".repeat(k % 7)} 🐘` })) };
    const pdf = await renderInvoicePdf(big, ISSUER_PARTY);
    expect(isPdf(pdf)).toBe(true);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
  });

  it("rectificativa: título propio y la serie, el número y la fecha de la factura que rectifica", async () => {
    const { store, inv } = await issued();
    const rect: Invoice = { ...inv, id: inv.id + 100, kind: "rectification", originalInvoiceId: inv.id, number: "EB-2026-00002", baseCents: -100_000, taxCents: -21_000, totalCents: -121_000 };
    const original = await rectifiedOf(rect, (x) => store.get(x));
    expect(original).toEqual({ number: "EB-2026-00001", issueDate: inv.issueDate });
    const text = JSON.stringify(invoicePdfBlocks(rect, ISSUER_PARTY, { original }));
    expect(text).toContain("Factura rectificativa");
    expect(text).toContain("factura EB-2026-00001 de 01/11/2026");
    expect(text).not.toContain("referencia interna");
    expect(isPdf(await renderInvoicePdf(rect, ISSUER_PARTY, { original }))).toBe(true);
  });
});

describe("GET /invoicing/invoices/:id/pdf", () => {
  let server: http.Server;
  let base: string;
  let id: number;
  beforeAll(async () => {
    const { svc, inv } = await issued();
    id = inv.id;
    const app = express();
    app.use(authenticate([{ id: "crm", sha256: hashToken(TOKEN), scopes: ["billing:read"], actorType: "crm" }]));
    app.use("/cp/v1/invoicing", createInvoicingRouter(svc, ISSUER_PARTY));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cp/v1/invoicing`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("entrega application/pdf con un PDF de verdad y el nombre de la factura (el HTML sigue en /document)", async () => {
    const res = await fetch(`${base}/invoices/${id}/pdf`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/pdf/);
    expect(res.headers.get("content-disposition")).toContain("factura-EB-2026-00001.pdf");
    const body = new Uint8Array(await res.arrayBuffer());
    expect(isPdf(body)).toBe(true);
    expect((await PDFDocument.load(body)).getPageCount()).toBeGreaterThanOrEqual(1);
    const html = await fetch(`${base}/invoices/${id}/document`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(html.headers.get("content-type")).toMatch(/^text\/html/);
  }, 20_000);
});
