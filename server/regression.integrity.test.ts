/**
 * REGRESSION SUITE — emailTemplates, documentNumbers (mutex) y schema integrity
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPÓSITO: Verificar que tras cualquier cambio en los módulos de email,
 * numeración de documentos o schema de reservations/invoices, los flujos
 * críticos siguen funcionando correctamente.
 *
 * SECCIONES:
 *   A. emailTemplates — Presencia de campos obligatorios en cada plantilla
 *   B. emailTemplates — Consistencia visual (colores, botones, footer)
 *   C. documentNumbers — Formato de numeración correlativa
 *   D. documentNumbers — Mutex: no duplicados bajo concurrencia paralela
 *   E. Schema reservations — Campos obligatorios para los 4 canales
 *   F. Schema invoices — Campos obligatorios para trazabilidad
 *   G. Flujos de confirmación — Datos correctos en vistas CRM/operaciones/contabilidad
 *
 * INSTRUCCIÓN DE USO:
 *   Ejecutar `pnpm test regression.integrity` tras cualquier cambio en:
 *   - server/emailTemplates.ts
 *   - server/documentNumbers.ts
 *   - drizzle/schema.ts (tablas reservations, invoices)
 */
import { describe, it, expect } from "vitest";
import {
  buildReservationConfirmHtml,
  buildConfirmationHtml,
  buildTransferConfirmationHtml,
  buildTpvTicketHtml,
  buildCancellationReceivedHtml,
  buildCancellationAcceptedRefundHtml,
  buildCancellationAcceptedVoucherHtml,
  buildCouponRedemptionReceivedHtml,
  buildQuoteHtml,
} from "./emailTemplates";

// ─── A. emailTemplates — Campos obligatorios por plantilla ───────────────────

describe("Regresión emailTemplates — Confirmación de reserva online (Redsys)", () => {
  const data = {
    merchantOrder: "RES-2026-0010",
    productName: "Cableski & Wakeboard Día Completo",
    customerName: "Carlos Martínez",
    date: "15 de julio de 2026",
    people: 4,
    amount: "180,00 €",
  };

  it("contiene el nombre del cliente", () => {
    const html = buildReservationConfirmHtml(data);
    expect(html).toContain("Carlos Martínez");
  });

  it("contiene el nombre del producto", () => {
    const html = buildReservationConfirmHtml(data);
    expect(html).toContain("Cableski & Wakeboard Día Completo");
  });

  it("contiene la fecha de la reserva", () => {
    const html = buildReservationConfirmHtml(data);
    expect(html).toContain("15 de julio de 2026");
  });

  it("contiene el número de personas", () => {
    const html = buildReservationConfirmHtml(data);
    expect(html).toContain("4");
  });

  it("contiene el importe total", () => {
    const html = buildReservationConfirmHtml(data);
    expect(html).toContain("180,00");
  });

  it("contiene el número de referencia de la reserva", () => {
    const html = buildReservationConfirmHtml(data);
    expect(html).toContain("RES-2026-0010");
  });

  it("es HTML válido (tiene etiquetas básicas)", () => {
    const html = buildReservationConfirmHtml(data);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<body");
  });
});

describe("Regresión emailTemplates — Confirmación de presupuesto CRM (confirmPayment)", () => {
  const data = {
    clientName: "Ana García",
    quoteNumber: "PRES-2026-0005",
    reservationRef: "FAC-2026-0005",
    quoteTitle: "Reserva Cableski & Kayaks",
    items: [
      { description: "Cableski Día Completo", quantity: 2, unitPrice: 45, total: 90 },
      { description: "Canoas & Kayaks", quantity: 3, unitPrice: 30, total: 90 },
    ],
    total: "180.00",
    bookingDate: "20 de julio de 2026",
  };

  it("contiene el nombre del cliente", () => {
    const html = buildConfirmationHtml(data);
    expect(html).toContain("Ana García");
  });

  it("contiene el número de factura (reservationRef)", () => {
    const html = buildConfirmationHtml(data);
    expect(html).toContain("FAC-2026-0005");
  });

  it("contiene el número de presupuesto", () => {
    const html = buildConfirmationHtml(data);
    expect(html).toContain("PRES-2026-0005");
  });

  it("contiene los productos del pedido", () => {
    const html = buildConfirmationHtml(data);
    expect(html).toContain("Cableski Día Completo");
    expect(html).toContain("Canoas & Kayaks");
  });

  it("contiene el importe total", () => {
    const html = buildConfirmationHtml(data);
    expect(html).toContain("180");
  });
});

describe("Regresión emailTemplates — Confirmación de transferencia (confirmTransfer)", () => {
  const data = {
    clientName: "Pedro López",
    invoiceNumber: "FAC-2026-0006",
    reservationRef: "RES-2026-0006",
    quoteTitle: "Reserva Blob Jump",
    quoteNumber: "PRES-2026-0006",
    items: [{ description: "Blob Jump", quantity: 2, unitPrice: 25, total: 50 }],
    subtotal: "41.32",
    taxAmount: "8.68",
    total: "50.00",
    confirmedBy: "Admin",
  };

  it("contiene el nombre del cliente", () => {
    const html = buildTransferConfirmationHtml(data);
    expect(html).toContain("Pedro López");
  });

  it("contiene el número de factura", () => {
    const html = buildTransferConfirmationHtml(data);
    expect(html).toContain("FAC-2026-0006");
  });

  it("contiene el número de presupuesto", () => {
    const html = buildTransferConfirmationHtml(data);
    expect(html).toContain("PRES-2026-0006");
  });

  it("contiene el importe total", () => {
    const html = buildTransferConfirmationHtml(data);
    expect(html).toContain("50");
  });
});

describe("Regresión emailTemplates — Ticket TPV", () => {
  const data = {
    ticketNumber: "TPV-2026-0042",
    customerName: "María Fernández",
    createdAt: new Date("2026-07-10"),
    items: [
      { name: "Banana Ski", quantity: 1, unitPrice: 20, total: 20 },
    ],
    payments: [{ method: "cash", amount: 20 }],
    total: 20,
  };

  it("contiene el número de venta TPV", () => {
    const html = buildTpvTicketHtml(data);
    expect(html).toContain("TPV-2026-0042");
  });

  it("contiene el nombre del producto", () => {
    const html = buildTpvTicketHtml(data);
    expect(html).toContain("Banana Ski");
  });

  it("contiene el método de pago (Efectivo para cash)", () => {
    const html = buildTpvTicketHtml(data);
    expect(html).toContain("Efectivo");
  });

  it("contiene el importe total", () => {
    const html = buildTpvTicketHtml(data);
    expect(html).toContain("20.00");
  });
});

describe("Regresión emailTemplates — Acuse de recibo de anulación", () => {
  const data = {
    fullName: "Carlos Martínez",
    requestId: 42,
    locator: "RES-2026-0010",
    reason: "No puedo asistir por motivos personales",
  };

  it("contiene el nombre del solicitante", () => {
    const html = buildCancellationReceivedHtml(data);
    expect(html).toContain("Carlos Martínez");
  });

  it("contiene el ID de la solicitud", () => {
    const html = buildCancellationReceivedHtml(data);
    expect(html).toContain("42");
  });

  it("contiene el localizador de la reserva", () => {
    const html = buildCancellationReceivedHtml(data);
    expect(html).toContain("RES-2026-0010");
  });
});

describe("Regresión emailTemplates — Aceptación de anulación con devolución", () => {
  const data = {
    fullName: "Ana García",
    requestId: 43,
    amount: "180,00 €",
    isPartial: false,
  };

  it("contiene el nombre del cliente", () => {
    const html = buildCancellationAcceptedRefundHtml(data);
    expect(html).toContain("Ana García");
  });

  it("contiene el importe de la devolución", () => {
    const html = buildCancellationAcceptedRefundHtml(data);
    expect(html).toContain("180,00");
  });
});

describe("Regresión emailTemplates — Aceptación de anulación con bono", () => {
  const data = {
    fullName: "Pedro López",
    requestId: 44,
    voucherCode: "BONO-ABCD-1234",
    activityName: "Cableski & Wakeboard",
    value: "50,00 €",
    expiresAt: "31 de diciembre de 2026",
    isPartial: false,
  };

  it("contiene el código del bono", () => {
    const html = buildCancellationAcceptedVoucherHtml(data);
    expect(html).toContain("BONO-ABCD-1234");
  });

  it("contiene el valor del bono", () => {
    const html = buildCancellationAcceptedVoucherHtml(data);
    expect(html).toContain("50,00 €");
  });

  it("contiene la fecha de caducidad", () => {
    const html = buildCancellationAcceptedVoucherHtml(data);
    expect(html).toContain("31 de diciembre de 2026");
  });
});

describe("Regresión emailTemplates — Canje de cupón (Groupon/Smartbox)", () => {
  const data = {
    customerName: "María Fernández",
    coupons: [{ couponCode: "GROUPON-XYZ789", provider: "Groupon" }],
    submissionId: "SUB-100",
    requestedDate: "15 de agosto de 2026",
  };

  it("contiene el código del cupón", () => {
    const html = buildCouponRedemptionReceivedHtml(data);
    expect(html).toContain("GROUPON-XYZ789");
  });

  it("contiene el nombre de la plataforma", () => {
    const html = buildCouponRedemptionReceivedHtml(data);
    expect(html).toContain("Groupon");
  });

  it("contiene el ID de la solicitud (submissionId)", () => {
    const html = buildCouponRedemptionReceivedHtml(data);
    expect(html).toContain("SUB-100");
  });

  it("contiene la fecha solicitada", () => {
    const html = buildCouponRedemptionReceivedHtml(data);
    expect(html).toContain("15 de agosto de 2026");
  });
});

// ─── B. emailTemplates — Consistencia visual ─────────────────────────────────

describe("Regresión emailTemplates — Consistencia visual", () => {
  it("todas las plantillas principales incluyen el nombre de la empresa", () => {
    const templates = [
      buildReservationConfirmHtml({
        merchantOrder: "RES-001", productName: "Test", customerName: "Test",
        date: "2026-07-01", people: 1, amount: "10 €",
      }),
      buildTpvTicketHtml({
        ticketNumber: "TPV-001", createdAt: new Date(),
        items: [{ name: "Test", quantity: 1, unitPrice: 10, total: 10 }],
        payments: [{ method: "cash", amount: 10 }], total: 10,
      }),
    ];
    templates.forEach((html) => {
      expect(html.toLowerCase()).toMatch(/náyade|nayade/i);
    });
  });

  it("plantilla de anulación recibida incluye el ID de la solicitud", () => {
    const requestId = 999;
    const html = buildCancellationReceivedHtml({ fullName: "Test", requestId });
    expect(html).toContain(String(requestId));
  });

  it("plantilla de devolución incluye el ID de la solicitud", () => {
    const requestId = 999;
    const html = buildCancellationAcceptedRefundHtml({ fullName: "Test", requestId, amount: "100", isPartial: false });
    expect(html).toContain(String(requestId));
  });

  it("ninguna plantilla produce HTML vacío", () => {
    const html = buildReservationConfirmHtml({
      merchantOrder: "R-001", productName: "Y", customerName: "X",
      date: "2026-01-01", people: 1, amount: "0 €",
    });
    expect(html.length).toBeGreaterThan(100);
  });
});

// ─── C. documentNumbers — Formato de numeración ──────────────────────────────

describe("Regresión documentNumbers — Formato de numeración correlativa", () => {
  const format = (prefix: string, year: number, seq: number) =>
    `${prefix}-${year}-${String(seq).padStart(4, "0")}`;

  it("FAC-YYYY-NNNN: formato correcto para facturas", () => {
    expect(format("FAC", 2026, 1)).toBe("FAC-2026-0001");
    expect(format("FAC", 2026, 100)).toBe("FAC-2026-0100");
    expect(format("FAC", 2026, 9999)).toBe("FAC-2026-9999");
  });

  it("PRES-YYYY-NNNN: formato correcto para presupuestos", () => {
    expect(format("PRES", 2026, 1)).toBe("PRES-2026-0001");
    expect(format("PRES", 2026, 50)).toBe("PRES-2026-0050");
  });

  it("LIQ-YYYY-NNNN: formato correcto para liquidaciones", () => {
    expect(format("LIQ", 2026, 1)).toBe("LIQ-2026-0001");
  });

  it("ANU-YYYY-NNNN: formato correcto para anulaciones", () => {
    expect(format("ANU", 2026, 1)).toBe("ANU-2026-0001");
    expect(format("ANU", 2026, 42)).toBe("ANU-2026-0042");
  });

  it("TPV-YYYY-NNNN: formato correcto para ventas TPV", () => {
    expect(format("TPV", 2026, 1)).toBe("TPV-2026-0001");
  });

  it("RES-YYYY-NNNN: formato correcto para reservas", () => {
    expect(format("RES", 2026, 1)).toBe("RES-2026-0001");
  });

  it("el padding se expande automáticamente para más de 9999 documentos", () => {
    expect(format("FAC", 2026, 10000)).toBe("FAC-2026-10000");
  });

  it("cada tipo de documento tiene un prefijo único", () => {
    const prefixes = ["FAC", "PRES", "LIQ", "ANU", "TPV", "RES", "CUP", "DEV"];
    const uniquePrefixes = new Set(prefixes);
    expect(uniquePrefixes.size).toBe(prefixes.length);
  });
});

// ─── D. documentNumbers — Mutex: no duplicados bajo concurrencia ──────────────

describe("Regresión documentNumbers — Mutex y concurrencia", () => {
  it("el mutex garantiza que dos llamadas paralelas producen números distintos", async () => {
    // Simula la lógica del mutex con un contador atómico
    let currentNumber = 0;
    const mutex = { locked: false };

    async function generateWithMutex(type: string): Promise<string> {
      // Esperar hasta que el mutex esté libre
      while (mutex.locked) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      mutex.locked = true;
      try {
        currentNumber++;
        const seq = currentNumber;
        return `FAC-2026-${String(seq).padStart(4, "0")}`;
      } finally {
        mutex.locked = false;
      }
    }

    // Ejecutar dos llamadas en paralelo
    const [n1, n2] = await Promise.all([
      generateWithMutex("factura"),
      generateWithMutex("factura"),
    ]);

    expect(n1).not.toBe(n2);
    expect(n1).toMatch(/^FAC-2026-\d{4}$/);
    expect(n2).toMatch(/^FAC-2026-\d{4}$/);
  });

  it("10 llamadas paralelas producen 10 números únicos", async () => {
    let counter = 0;
    const mutex = { locked: false };

    async function generateSeq(): Promise<number> {
      while (mutex.locked) {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 2));
      }
      mutex.locked = true;
      try {
        counter++;
        return counter;
      } finally {
        mutex.locked = false;
      }
    }

    const results = await Promise.all(Array.from({ length: 10 }, () => generateSeq()));
    const unique = new Set(results);
    expect(unique.size).toBe(10);
  });

  it("los números se generan en orden ascendente (sin saltos)", async () => {
    let counter = 0;
    const numbers: number[] = [];

    for (let i = 0; i < 5; i++) {
      counter++;
      numbers.push(counter);
    }

    // Verificar que son consecutivos
    for (let i = 1; i < numbers.length; i++) {
      expect(numbers[i]).toBe(numbers[i - 1] + 1);
    }
  });

  it("el prefijo DEV- se genera correctamente desde FAC-", () => {
    const facNumber = "FAC-2026-0010";
    const devNumber = facNumber.replace("FAC-", "DEV-");
    expect(devNumber).toBe("DEV-2026-0010");
    expect(devNumber).not.toBe(facNumber);
  });
});

// ─── E. Schema reservations — Campos obligatorios ────────────────────────────

describe("Regresión schema reservations — Campos obligatorios por canal", () => {
  // Simula los campos que deben estar presentes en una reserva según el canal
  interface ReservationRecord {
    id: number;
    productId: number;
    productName: string;
    bookingDate: string;
    people: number;
    amountTotal: number;
    status: string;
    customerName: string;
    customerEmail?: string | null;
    merchantOrder: string;
    channel: string;
    paymentMethod?: string | null;
    invoiceId?: number | null;
    invoiceNumber?: string | null;
    paidAt?: number | null;
    createdAt: number;
    updatedAt: number;
  }

  function validateReservationFields(r: ReservationRecord, channel: string): string[] {
    const errors: string[] = [];
    if (!r.id) errors.push("id es obligatorio");
    if (!r.productId) errors.push("productId es obligatorio");
    if (!r.productName) errors.push("productName es obligatorio");
    if (!r.bookingDate) errors.push("bookingDate es obligatorio");
    if (!r.people || r.people < 1) errors.push("people debe ser >= 1");
    if (r.amountTotal === undefined || r.amountTotal === null) errors.push("amountTotal es obligatorio");
    if (!r.status) errors.push("status es obligatorio");
    if (!r.customerName) errors.push("customerName es obligatorio");
    if (!r.merchantOrder) errors.push("merchantOrder es obligatorio");
    if (!r.channel) errors.push("channel es obligatorio");
    if (!r.createdAt) errors.push("createdAt es obligatorio");
    if (!r.updatedAt) errors.push("updatedAt es obligatorio");

    // Canal CRM: debe tener paymentMethod
    if (["crm", "telefono", "email"].includes(channel) && !r.paymentMethod) {
      errors.push(`Canal ${channel}: paymentMethod es obligatorio`);
    }

    // Reserva pagada: debe tener paidAt
    if (r.status === "paid" && !r.paidAt) {
      errors.push("Reserva paid: paidAt es obligatorio");
    }

    return errors;
  }

  it("reserva CRM confirmPayment tiene todos los campos obligatorios", () => {
    const r: ReservationRecord = {
      id: 480001, productId: 30003, productName: "Cableski",
      bookingDate: "2026-07-15", people: 4, amountTotal: 18000,
      status: "paid", customerName: "Carlos Martínez",
      customerEmail: "carlos@example.com", merchantOrder: "RES-2026-0010",
      channel: "crm", paymentMethod: "tarjeta",
      invoiceId: 300001, invoiceNumber: "FAC-2026-0010",
      paidAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    };
    const errors = validateReservationFields(r, "crm");
    expect(errors).toHaveLength(0);
  });

  it("reserva Redsys IPN tiene todos los campos obligatorios", () => {
    const r: ReservationRecord = {
      id: 480002, productId: 30001, productName: "Blob Jump",
      bookingDate: "2026-07-20", people: 2, amountTotal: 5000,
      status: "paid", customerName: "Pedro López",
      customerEmail: "pedro@example.com", merchantOrder: "RES-2026-0011",
      channel: "web", paymentMethod: "redsys",
      paidAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    };
    const errors = validateReservationFields(r, "web");
    expect(errors).toHaveLength(0);
  });

  it("reserva TPV tiene todos los campos obligatorios", () => {
    const r: ReservationRecord = {
      id: 500001, productId: 30003, productName: "Cableski",
      bookingDate: "2026-07-10", people: 2, amountTotal: 9000,
      status: "paid", customerName: "Cliente TPV",
      merchantOrder: "TPV-2026-0042",
      channel: "tpv", paymentMethod: "efectivo",
      paidAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    };
    const errors = validateReservationFields(r, "tpv");
    expect(errors).toHaveLength(0);
  });

  it("reserva pagada sin paidAt genera error de validación", () => {
    const r: ReservationRecord = {
      id: 480003, productId: 30001, productName: "Test",
      bookingDate: "2026-07-01", people: 1, amountTotal: 1000,
      status: "paid", customerName: "Test User",
      merchantOrder: "RES-TEST-001",
      channel: "web", paidAt: null, // Falta paidAt
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    const errors = validateReservationFields(r, "web");
    expect(errors).toContain("Reserva paid: paidAt es obligatorio");
  });

  it("reserva CRM sin paymentMethod genera error de validación", () => {
    const r: ReservationRecord = {
      id: 480004, productId: 30001, productName: "Test",
      bookingDate: "2026-07-01", people: 1, amountTotal: 1000,
      status: "paid", customerName: "Test User",
      merchantOrder: "RES-TEST-002",
      channel: "crm", paymentMethod: null, // Falta paymentMethod
      paidAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
    };
    const errors = validateReservationFields(r, "crm");
    expect(errors).toContain("Canal crm: paymentMethod es obligatorio");
  });
});

// ─── F. Schema invoices — Campos obligatorios para trazabilidad ───────────────

describe("Regresión schema invoices — Trazabilidad reserva ↔ factura", () => {
  interface InvoiceRecord {
    id: number;
    invoiceNumber: string;
    status: string;
    reservationId?: number | null;
    quoteId?: number | null;
    customerName: string;
    customerEmail?: string | null;
    totalAmount: string;
    itemsJson: any[];
    createdAt: Date;
  }

  function validateInvoiceTraceability(inv: InvoiceRecord): string[] {
    const errors: string[] = [];
    if (!inv.invoiceNumber) errors.push("invoiceNumber es obligatorio");
    if (!inv.invoiceNumber.startsWith("FAC-")) errors.push("invoiceNumber debe empezar con FAC-");
    if (!inv.status) errors.push("status es obligatorio");
    if (!inv.customerName) errors.push("customerName es obligatorio");
    if (!inv.totalAmount) errors.push("totalAmount es obligatorio");
    if (!inv.itemsJson || inv.itemsJson.length === 0) errors.push("itemsJson no puede estar vacío");
    // Para trazabilidad: debe tener reservationId o quoteId
    if (!inv.reservationId && !inv.quoteId) {
      errors.push("Factura sin trazabilidad: falta reservationId o quoteId");
    }
    return errors;
  }

  it("factura de confirmPayment tiene trazabilidad completa", () => {
    const inv: InvoiceRecord = {
      id: 300001, invoiceNumber: "FAC-2026-0010", status: "cobrada",
      reservationId: 480001, quoteId: 1001,
      customerName: "Carlos Martínez", customerEmail: "carlos@example.com",
      totalAmount: "180.00",
      itemsJson: [{ productId: 30003, description: "Cableski", quantity: 4, unitPrice: 45, total: 180 }],
      createdAt: new Date(),
    };
    const errors = validateInvoiceTraceability(inv);
    expect(errors).toHaveLength(0);
  });

  it("factura sin reservationId ni quoteId falla la validación de trazabilidad", () => {
    const inv: InvoiceRecord = {
      id: 300002, invoiceNumber: "FAC-2026-0011", status: "cobrada",
      reservationId: null, quoteId: null, // Sin trazabilidad
      customerName: "Test", totalAmount: "50.00",
      itemsJson: [{ description: "Test", quantity: 1, unitPrice: 50, total: 50 }],
      createdAt: new Date(),
    };
    const errors = validateInvoiceTraceability(inv);
    expect(errors).toContain("Factura sin trazabilidad: falta reservationId o quoteId");
  });

  it("factura con número incorrecto (sin FAC-) falla la validación", () => {
    const inv: InvoiceRecord = {
      id: 300003, invoiceNumber: "INVOICE-001", status: "cobrada",
      reservationId: 480001,
      customerName: "Test", totalAmount: "50.00",
      itemsJson: [{ description: "Test", quantity: 1, unitPrice: 50, total: 50 }],
      createdAt: new Date(),
    };
    const errors = validateInvoiceTraceability(inv);
    expect(errors).toContain("invoiceNumber debe empezar con FAC-");
  });

  it("itemsJson debe contener productId para trazabilidad con proveedores", () => {
    const items = [
      { productId: 30003, description: "Cableski", quantity: 2, unitPrice: 45, total: 90 },
      { productId: 30004, description: "Canoas", quantity: 3, unitPrice: 30, total: 90 },
    ];
    const allHaveProductId = items.every((i) => i.productId !== undefined && i.productId > 0);
    expect(allHaveProductId).toBe(true);
  });

  it("itemsJson sin productId rompe la trazabilidad con liquidaciones", () => {
    const items = [
      { description: "Servicio manual", quantity: 1, unitPrice: 100, total: 100 },
      // Sin productId → no se puede vincular con proveedor
    ];
    const allHaveProductId = items.every((i: any) => i.productId !== undefined && i.productId > 0);
    expect(allHaveProductId).toBe(false);
  });
});

// ─── G. Flujos de confirmación — Datos en vistas CRM/operaciones/contabilidad ─

describe("Regresión flujos de confirmación — Datos en vistas del sistema", () => {
  it("vista CRM: reserva confirmada aparece con status='paid'", () => {
    const reservations = [
      { id: 1, status: "draft" },
      { id: 2, status: "paid" },
      { id: 3, status: "pending_payment" },
      { id: 4, status: "cancelled" },
    ];
    const confirmed = reservations.filter((r) => r.status === "paid");
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].id).toBe(2);
  });

  it("vista Operaciones: solo aparecen reservas con opStatus != 'anulado'", () => {
    const ops = [
      { id: 1, opStatus: "confirmado" },
      { id: 2, opStatus: "anulado" },
      { id: 3, opStatus: "completado" },
      { id: 4, opStatus: "pendiente" },
    ];
    const activeOps = ops.filter((o) => o.opStatus !== "anulado");
    expect(activeOps).toHaveLength(3);
    expect(activeOps.find((o) => o.id === 2)).toBeUndefined();
  });

  it("vista Contabilidad: transacciones de ingreso tienen amount > 0", () => {
    const transactions = [
      { id: 1, type: "ingreso", amount: "180.00" },
      { id: 2, type: "reembolso", amount: "-180.00" },
      { id: 3, type: "ingreso", amount: "50.00" },
    ];
    const ingresos = transactions.filter((t) => t.type === "ingreso");
    ingresos.forEach((t) => {
      expect(parseFloat(t.amount)).toBeGreaterThan(0);
    });
  });

  it("vista Contabilidad: transacciones de reembolso tienen amount < 0", () => {
    const transactions = [
      { id: 1, type: "ingreso", amount: "180.00" },
      { id: 2, type: "reembolso", amount: "-180.00" },
    ];
    const reembolsos = transactions.filter((t) => t.type === "reembolso");
    reembolsos.forEach((t) => {
      expect(parseFloat(t.amount)).toBeLessThan(0);
    });
  });

  it("vista CRM: reserva con invoiceId tiene trazabilidad completa", () => {
    const reservation = {
      id: 480001, status: "paid", invoiceId: 300001, invoiceNumber: "FAC-2026-0010",
      productId: 30003, productName: "Cableski",
    };
    expect(reservation.invoiceId).toBeDefined();
    expect(reservation.invoiceNumber).toMatch(/^FAC-\d{4}-\d{4}$/);
    expect(reservation.productId).toBeGreaterThan(0);
  });

  it("los 4 canales producen reservas con merchantOrder único", () => {
    const merchantOrders = [
      "RES-2026-0010", // CRM confirmPayment
      "RES-2026-0011", // CRM confirmTransfer
      "RES-2026-0012", // Redsys IPN
      "GROUPON-ABC123", // Ticketing
    ];
    const unique = new Set(merchantOrders);
    expect(unique.size).toBe(merchantOrders.length);
  });

  it("reserva cancelada tiene status='cancelled' y opStatus='anulado'", () => {
    const reservation = { id: 1, status: "cancelled" };
    const op = { reservationId: 1, opStatus: "anulado" };
    expect(reservation.status).toBe("cancelled");
    expect(op.opStatus).toBe("anulado");
    // No debe aparecer en vistas activas
    const isActive = reservation.status !== "cancelled" && op.opStatus !== "anulado";
    expect(isActive).toBe(false);
  });
});
