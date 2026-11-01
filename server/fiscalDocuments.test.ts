/**
 * Documentos fiscales emitidos y su IVA (server/fiscalDocuments.ts): la regla única de Informes, Resumen,
 * Modelo 303 y libro de facturas, incluida la de no duplicar un ticket que tiene su factura completa.
 * También el recuento por operación y lo pendiente tras abonos del Inicio, y el libro con los tickets.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  invoiceDocument,
  substitutingInvoice,
  summarizeFiscalDocuments,
  ticketDocument,
  type FiscalInvoiceRow,
  type FiscalTicketRow,
} from "./fiscalDocuments";
import { buildGestoriaInvoiceZip, buildInvoiceLedgerCsv } from "./gestoriaInvoiceExport";
import { resolveExportPeriod } from "../shared/gestoriaExportPeriod";
import { summarizeSales, unpaidAfterCredits } from "./coreHomeDb";
import { buildAccountingSummary } from "./accountingSummary";

const day = new Date("2026-11-01T10:00:00Z");

function inv(p: Partial<FiscalInvoiceRow> & Pick<FiscalInvoiceRow, "id" | "invoiceNumber" | "total">): FiscalInvoiceRow {
  return {
    invoiceType: "factura",
    status: "generada",
    clientName: "Cliente SL",
    clientNif: "B12345674",
    itemsJson: [],
    taxRate: "21",
    taxAmount: "0",
    taxBreakdown: null,
    creditNoteForId: null,
    issuedAt: day,
    ...p,
  };
}

function ticket(p: Partial<FiscalTicketRow> & Pick<FiscalTicketRow, "id" | "ticketNumber" | "total" | "lines">): FiscalTicketRow {
  return { status: "paid", at: day.getTime() + p.id * 1000, customerName: "Mostrador", invoiceId: null, reservationId: null, ...p };
}

// Escenario mixto: pedido web con dos artículos (21 % y 10 %), presupuesto cobrado, factura libre con 21/10/0 % y
// abono parcial, dos tickets de caja, una venta con tarjeta (ticket + factura) y un ticket canjeado por factura
const web = inv({ id: 1, invoiceNumber: "FAC-2026-0001", status: "cobrada", total: "46.20", taxAmount: "6.20", taxBreakdown: [{ rate: 21, base: 20, amount: 4.2 }, { rate: 10, base: 20, amount: 2 }] });
const quote = inv({ id: 2, invoiceNumber: "FAC-2026-0002", status: "cobrada", total: "121.00", taxAmount: "21.00", taxBreakdown: [{ rate: 21, base: 100, amount: 21 }] });
const free = inv({ id: 3, invoiceNumber: "FAC-2026-0003", total: "311.00", taxAmount: "31.00", taxBreakdown: [{ rate: 21, base: 100, amount: 21 }, { rate: 10, base: 100, amount: 10 }, { rate: 0, base: 80, amount: 0 }] });
const credit = inv({ id: 4, invoiceNumber: "ABO-2026-11-0001", invoiceType: "abono", creditNoteForId: 3, total: "-31.10", taxAmount: "-3.10", taxBreakdown: [{ rate: 21, base: -10, amount: -2.1 }, { rate: 10, base: -10, amount: -1 }, { rate: 0, base: -8, amount: 0 }] });
const card = inv({ id: 5, invoiceNumber: "FAC-2026-0004", status: "cobrada", total: "24.20", taxAmount: "4.20", taxBreakdown: [{ rate: 21, base: 20, amount: 4.2 }], issuedAt: new Date(day.getTime() + 3000) });
const swap = inv({ id: 6, invoiceNumber: "FAC-2026-0005", total: "24.20", taxAmount: "4.20", taxBreakdown: [{ rate: 21, base: 20, amount: 4.2 }], issuedAt: new Date(day.getTime() + 5000) });
const t1 = ticket({ id: 1, ticketNumber: "TPV-2026-0001", total: "34.20", reservationId: 101, lines: [{ subtotal: "24.20", fiscalRegime: "general", taxRate: "21" }, { subtotal: "10.00", fiscalRegime: "general", taxRate: "0" }] });
const t2 = ticket({ id: 2, ticketNumber: "TPV-2026-0002", total: "11.00", reservationId: 102, lines: [{ subtotal: "11.00", fiscalRegime: "general", taxRate: "10" }] });
const t3 = ticket({ id: 3, ticketNumber: "TPV-2026-0003", total: "24.20", reservationId: 103, invoiceId: 5, lines: [{ subtotal: "24.20", fiscalRegime: "general", taxRate: "21" }] });
// Canjeado por factura sin el enlace en la venta: se reconoce por el pedido de la caja
const t4 = ticket({ id: 4, ticketNumber: "TPV-2026-0004", total: "24.20", reservationId: 104, lines: [{ subtotal: "24.20", fiscalRegime: "general", taxRate: "21" }] });
const substitutes = [
  { id: 5, invoiceNumber: "FAC-2026-0004", invoiceType: "factura", status: "cobrada", reservationId: 103 },
  { id: 6, invoiceNumber: "FAC-2026-0005", invoiceType: "factura", status: "generada", reservationId: 104 },
];
const originals = new Map([[3, "FAC-2026-0003"]]);
const invoiceRows = [web, quote, free, credit, card, swap];
const ticketDocs = [t1, t2, t3, t4].map((t) => ticketDocument(t, substitutingInvoice(t, substitutes)));
const docs = [...invoiceRows.map((r) => invoiceDocument(r, originals)), ...ticketDocs];

describe("documentos fiscales: IVA repercutido por tipo", () => {
  it("facturas, abono en negativo y tickets sin duplicar la venta con factura completa", () => {
    const s = summarizeFiscalDocuments(docs);
    expect(s.byRate).toEqual([
      { rate: 21, base: 270, amount: 56.7, total: 326.7 },
      { rate: 10, base: 120, amount: 12, total: 132 },
      { rate: 0, base: 82, amount: 0, total: 82 },
    ]);
    expect(s).toMatchObject({ base: 472, tax: 68.7, total: 540.7, notSubject: 0, invoices: 5, creditNotes: 1, tickets: 2, substitutedTickets: 2 });
  });

  it("el ticket con factura completa se lista como sustituido, sin importe", () => {
    const [d1, d2, d3, d4] = ticketDocs;
    expect(d1).toMatchObject({ kind: "ticket", counts: true, total: 34.2, base: 30, tax: 4.2, substitutedBy: null, status: "Cobrado" });
    expect(d2.byRate).toEqual([{ rate: 10, base: 10, amount: 1 }]);
    expect(d3).toMatchObject({ counts: false, total: 0, base: 0, tax: 0, byRate: [], substitutedBy: "FAC-2026-0004", status: "Sustituido por FAC-2026-0004" });
    expect(d4).toMatchObject({ counts: false, total: 0, substitutedBy: "FAC-2026-0005" });
  });

  it("regla de sustitución: factura enlazada o del pedido de la caja; nunca un abono ni una anulada", () => {
    expect(substitutingInvoice({ invoiceId: null, reservationId: null }, substitutes)).toBeNull();
    expect(substitutingInvoice({ invoiceId: 99, reservationId: null }, substitutes)).toBeNull();
    const credited = [{ id: 7, invoiceNumber: "ABO-1", invoiceType: "abono", status: "generada", reservationId: 105 }];
    expect(substitutingInvoice({ invoiceId: null, reservationId: 105 }, credited)).toBeNull();
    const voided = [{ id: 8, invoiceNumber: "FAC-9", invoiceType: "factura", status: "anulada", reservationId: 106 }];
    expect(substitutingInvoice({ invoiceId: 8, reservationId: 106 }, voided)).toBeNull();
    // Con la factura anulada, el ticket vuelve a ser el documento de la venta
    expect(ticketDocument(ticket({ id: 9, ticketNumber: "T-9", total: "12.10", invoiceId: 8, lines: [{ subtotal: "12.10", fiscalRegime: "general", taxRate: "21" }] }), null).counts).toBe(true);
  });

  it("ticket con descuento global e IVA mixto: el descuento se reparte por tipo antes de desglosar", () => {
    const d = ticketDocument(ticket({ id: 10, ticketNumber: "T-10", total: "207.90", lines: [{ subtotal: "121", fiscalRegime: "general", taxRate: "21" }, { subtotal: "110", fiscalRegime: "general", taxRate: "10" }] }), null);
    expect(d.byRate).toEqual([{ rate: 21, base: 90, amount: 18.9 }, { rate: 10, base: 90, amount: 9 }]);
    expect(d.total).toBe(207.9);
  });

  it("tickets anulados o devueltos y facturas anuladas se listan pero no cuentan", () => {
    const voided = ticketDocument(ticket({ id: 11, ticketNumber: "T-11", status: "cancelled", total: "50", lines: [{ subtotal: "50", fiscalRegime: "general", taxRate: "21" }] }), null);
    const refunded = ticketDocument(ticket({ id: 12, ticketNumber: "T-12", status: "refunded", total: "50", lines: [{ subtotal: "50", fiscalRegime: "general", taxRate: "21" }] }), null);
    const annulled = invoiceDocument(inv({ id: 13, invoiceNumber: "F-13", status: "anulada", total: "121", taxAmount: "21", taxBreakdown: [{ rate: 21, base: 100, amount: 21 }] }));
    expect([voided.status, refunded.status, annulled.status]).toEqual(["Anulado", "Devuelto", "Anulada"]);
    expect(summarizeFiscalDocuments([voided, refunded, annulled])).toMatchObject({ base: 0, tax: 0, total: 0, invoices: 0, tickets: 0 });
  });

  it("abono guardado en positivo (documentos antiguos): resta igualmente", () => {
    const old = invoiceDocument(inv({ id: 14, invoiceNumber: "ABO-OLD", invoiceType: "abono", total: "121", taxAmount: "21", taxBreakdown: [{ rate: 21, base: 100, amount: 21 }] }));
    expect(old).toMatchObject({ total: -121, base: -100, tax: -21 });
  });

  it("ticket sin líneas guardadas: la fiscalidad guardada de la venta", () => {
    const d = ticketDocument(ticket({ id: 15, ticketNumber: "T-15", total: "121", taxBase: "100", taxAmount: "21", taxRate: "21", lines: [] }), null);
    expect(d.byRate).toEqual([{ rate: 21, base: 100, amount: 21 }]);
  });
});

describe("libro de facturas emitidas con los tickets de caja", () => {
  const parse = (csv: string) => csv.replace(/^﻿/, "").trimEnd().split("\r\n").map((l) => l.split(";"));

  it("tipo «Factura simplificada / ticket», sustituidos sin importe y TOTAL igual al 303", () => {
    const rows = parse(buildInvoiceLedgerCsv(invoiceRows, originals, ticketDocs));
    expect(rows[0].slice(6, 12)).toEqual(["Base 21 %", "Cuota IVA 21 %", "Base 10 %", "Cuota IVA 10 %", "Base 0 %", "Cuota IVA 0 %"]);
    const byNumber = Object.fromEntries(rows.slice(1, -1).map((r) => [r[0], r]));
    expect(byNumber["TPV-2026-0001"].slice(2, 3)).toEqual(["Factura simplificada / ticket"]);
    expect(byNumber["TPV-2026-0001"].slice(6, 17)).toEqual(["20,00", "4,20", "", "", "10,00", "0,00", "30,00", "4,20", "0,00", "34,20", "Cobrado"]);
    expect(byNumber["TPV-2026-0003"].slice(12)).toEqual(["0,00", "0,00", "0,00", "0,00", "Sustituido por FAC-2026-0004"]);
    expect(byNumber["ABO-2026-11-0001"][3]).toBe("FAC-2026-0003");
    const total = rows[rows.length - 1];
    expect(total.slice(0, 5)).toEqual(["TOTAL", "", "", "", "10 documentos"]);
    expect(total.slice(6)).toEqual(["270,00", "56,70", "120,00", "12,00", "82,00", "0,00", "472,00", "68,70", "0,00", "540,70", ""]);
  });

  it("el TOTAL no suma las facturas anuladas", () => {
    const annulled = inv({ id: 20, invoiceNumber: "F-20", status: "anulada", total: "121", taxAmount: "21", taxBreakdown: [{ rate: 21, base: 100, amount: 21 }] });
    const rows = parse(buildInvoiceLedgerCsv([quote, annulled], new Map()));
    expect(rows[2].slice(6, 8)).toEqual(["100,00", "21,00"]);
    expect(rows[3].slice(6, 8)).toEqual(["100,00", "21,00"]);
  });

  it("ZIP: los tickets en el libro (sin PDF), su recuento y la regla en el LEEME", async () => {
    const period = resolveExportPeriod({ kind: "quarter", year: 2026, quarter: 4 });
    const out = await buildGestoriaInvoiceZip({
      companyName: "Empresa Prueba SL",
      period,
      rows: invoiceRows,
      originalNumbers: originals,
      tickets: ticketDocs,
      pdfFor: async (r) => Buffer.from(`%PDF ${r.invoiceNumber}`),
      generatedAt: day,
    });
    expect([out.invoices, out.creditNotes, out.tickets]).toEqual([5, 1, 4]);
    const zip = await JSZip.loadAsync(out.buffer);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(names.filter((n) => n.includes("TPV"))).toEqual([]);
    const csv = await zip.file("libro_facturas_emitidas_2026-T4.csv")!.async("string");
    expect(csv).toContain("TPV-2026-0002;");
    const readme = await zip.file("LEEME.txt")!.async("string");
    expect(readme).toContain("Tickets de caja (facturas simplificadas): 4 (2 sustituidos por su factura completa)");
    expect(readme).toContain("cuenta la factura y el ticket");
    expect(readme).toContain("Sustituido por");
  });
});

describe("Inicio y Resumen: operaciones, no líneas; lo pendiente tras abonos", () => {
  it("un pedido de la tienda con dos líneas es una venta", () => {
    const starts = { dayStart: 100, monthStart: 0 };
    const out = summarizeSales([
      { at: 200, amountTotal: 2420, amountPaid: 2420, key: "p:WEB1" },
      { at: 200, amountTotal: 2200, amountPaid: 2200, key: "p:WEB1" },
      { at: 300, amountTotal: 12100, amountPaid: 12100, key: "p:Q1" },
      { at: 400, amountTotal: 3420, amountPaid: 3420, key: "r:7" },
    ], starts);
    expect(out.today).toEqual({ amount: 201.4, count: 3 });
  });

  it("factura de 311 € con un abono parcial de 31,10 €: quedan 279,90 € por cobrar", () => {
    expect(unpaidAfterCredits([{ id: 3, total: "311.00" }, { id: 9, total: "50.00" }], [{ creditNoteForId: 3, total: "-31.10" }, { creditNoteForId: 9, total: "-50.00" }]))
      .toEqual({ count: 1, amount: 279.9 });
    expect(unpaidAfterCredits([], [])).toEqual({ count: 0, amount: 0 });
  });

  it("Resumen: Facturado con los tickets, sin el ticket sustituido; facturas y tickets por separado", () => {
    const now = day.getTime() + 3600_000;
    const s = buildAccountingSummary({
      now,
      sales: [{ at: now - 10, amount: 24.2, key: "p:WEB" }, { at: now - 10, amount: 22, key: "p:WEB" }, { at: now - 5, amount: 121, key: "p:Q" }],
      payments: [],
      invoices: docs.filter((d) => d.counts).map((d) => ({ at: now - 1, amount: d.total, kind: d.kind })),
      expenses: null,
      categories: [],
      pendingQuotes: null,
    });
    expect(s.totals).toMatchObject({ salesCount: 2, invoiced: 540.7, invoiceCount: 5, ticketCount: 2 });
  });
});
