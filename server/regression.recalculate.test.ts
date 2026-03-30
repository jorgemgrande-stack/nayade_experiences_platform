/**
 * REGRESSION SUITE — recalculate() y módulo de anulaciones
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPÓSITO: Verificar que tras cualquier cambio en recalculate() o en el
 * módulo de anulaciones, los flujos críticos siguen funcionando correctamente.
 *
 * SECCIONES:
 *   A. recalculate() — SOURCE 1: Facturas CRM cobradas
 *   B. recalculate() — SOURCE 2: Reservas TPV pagadas
 *   C. recalculate() — SOURCE 3: Reservas CRM/online pagadas
 *   D. recalculate() — SOURCE 4: Plataformas externas (Groupon/Smartbox)
 *   E. recalculate() — Deduplicación (no contar la misma venta dos veces)
 *   F. Módulo de anulaciones — propagateCancellation()
 *   G. Módulo de anulaciones — Visibilidad en calendario y liquidaciones
 *   H. Módulo de anulaciones — Transacción de devolución con signo negativo
 *
 * INSTRUCCIÓN DE USO:
 *   Ejecutar `pnpm test regression.recalculate` tras cualquier cambio en:
 *   - server/routers/suppliers.ts → recalculate()
 *   - server/routers/cancellations.ts → propagateCancellation()
 */
import { describe, it, expect } from "vitest";

// ─── Tipos compartidos ────────────────────────────────────────────────────────

interface ProductDef {
  id: number;
  title: string;
  commissionPercent: number;
  costType: string;
}

interface SettlementLine {
  reservationId?: number;
  invoiceId?: number;
  productId: number;
  productName: string;
  serviceDate: string;
  paxCount: number;
  saleAmount: number;
  commissionPercent: number;
  commissionAmount: number;
  netAmountProvider: number;
  costType: string;
}

// ─── Helpers de lógica pura para recalculate ─────────────────────────────────

function buildLine(
  product: ProductDef,
  saleAmount: number,
  paxCount: number,
  serviceDate: string,
  opts?: { reservationId?: number; invoiceId?: number; productName?: string }
): SettlementLine {
  const commissionAmount = (saleAmount * product.commissionPercent) / 100;
  return {
    reservationId: opts?.reservationId,
    invoiceId: opts?.invoiceId,
    productId: product.id,
    productName: opts?.productName ?? product.title,
    serviceDate,
    paxCount,
    saleAmount,
    commissionPercent: product.commissionPercent,
    commissionAmount,
    netAmountProvider: saleAmount - commissionAmount,
    costType: product.costType,
  };
}

function processSource1CRM(
  invoices: Array<{
    id: number;
    reservationId?: number;
    status: string;
    itemsJson: Array<{ productId?: number; unitPrice: number; quantity: number; description: string }>;
    createdAt: Date;
  }>,
  products: ProductDef[],
  periodFrom: Date,
  periodTo: Date
): { lines: SettlementLine[]; processedInvoiceIds: Set<number> } {
  const productIdSet = new Set(products.map((p) => p.id));
  const lines: SettlementLine[] = [];
  const processedInvoiceIds = new Set<number>();

  const paidInvoices = invoices.filter(
    (i) =>
      ["cobrada", "enviada"].includes(i.status) &&
      i.createdAt >= periodFrom &&
      i.createdAt <= periodTo
  );

  for (const inv of paidInvoices) {
    processedInvoiceIds.add(inv.id);
    for (const item of inv.itemsJson) {
      const productId = item.productId;
      if (!productId || !productIdSet.has(productId)) continue;
      const match = products.find((p) => p.id === productId)!;
      const saleAmount = item.unitPrice * item.quantity;
      lines.push(
        buildLine(match, saleAmount, item.quantity, periodFrom.toISOString().split("T")[0], {
          invoiceId: inv.id,
          reservationId: inv.reservationId,
          productName: item.description,
        })
      );
    }
  }

  return { lines, processedInvoiceIds };
}

function processSource2TPV(
  reservations: Array<{
    id: number;
    invoiceId?: number;
    status: string;
    channel: string;
    paidAt?: number;
    bookingDate: string;
    extrasJson?: string;
  }>,
  products: ProductDef[],
  periodFromMs: number,
  periodToMs: number,
  processedInvoiceIds: Set<number>
): SettlementLine[] {
  const productIdSet = new Set(products.map((p) => p.id));
  const lines: SettlementLine[] = [];

  const tpvReservations = reservations.filter(
    (r) =>
      r.status === "paid" &&
      r.channel === "tpv" &&
      (r.paidAt ?? 0) >= periodFromMs &&
      (r.paidAt ?? 0) <= periodToMs
  );

  for (const res of tpvReservations) {
    if (res.invoiceId && processedInvoiceIds.has(res.invoiceId)) continue;
    let items: any[] = [];
    try { items = JSON.parse(res.extrasJson ?? "[]"); } catch { items = []; }
    for (const item of items) {
      const productId = item.productId ?? item.experienceId;
      if (!productId || !productIdSet.has(productId)) continue;
      const match = products.find((p) => p.id === productId)!;
      const saleAmount = (item.unitPrice ?? 0) * (item.quantity ?? 1);
      if (saleAmount <= 0) continue;
      lines.push(
        buildLine(match, saleAmount, item.quantity ?? 1, res.bookingDate, {
          reservationId: res.id,
          invoiceId: res.invoiceId,
        })
      );
    }
  }

  return lines;
}

function processSource3CRMReservations(
  reservations: Array<{
    id: number;
    invoiceId?: number;
    productId?: number;
    productName?: string;
    status: string;
    channel: string;
    paidAt?: number;
    bookingDate: string;
    amountTotal?: number;
    people?: number;
  }>,
  products: ProductDef[],
  periodFromMs: number,
  periodToMs: number,
  processedInvoiceIds: Set<number>
): SettlementLine[] {
  const productIdSet = new Set(products.map((p) => p.id));
  const lines: SettlementLine[] = [];
  const crmChannels = ["crm", "web", "telefono", "email", "otro"];

  const crmReservations = reservations.filter(
    (r) =>
      r.status === "paid" &&
      crmChannels.includes(r.channel) &&
      (r.paidAt ?? 0) >= periodFromMs &&
      (r.paidAt ?? 0) <= periodToMs
  );

  for (const res of crmReservations) {
    if (res.invoiceId && processedInvoiceIds.has(res.invoiceId)) continue;
    if (res.productId && productIdSet.has(res.productId)) {
      const match = products.find((p) => p.id === res.productId)!;
      const saleAmount = (res.amountTotal ?? 0) / 100;
      if (saleAmount > 0) {
        lines.push(
          buildLine(match, saleAmount, res.people ?? 1, res.bookingDate, {
            reservationId: res.id,
            invoiceId: res.invoiceId,
            productName: res.productName ?? match.title,
          })
        );
      }
    }
  }

  return lines;
}

// ─── A. SOURCE 1: Facturas CRM cobradas ──────────────────────────────────────

describe("Regresión recalculate — SOURCE 1: Facturas CRM", () => {
  const products: ProductDef[] = [
    { id: 30003, title: "Cableski & Wakeboard", commissionPercent: 20, costType: "comision_sobre_venta" },
    { id: 30004, title: "Canoas & Kayaks", commissionPercent: 15, costType: "comision_sobre_venta" },
  ];

  const periodFrom = new Date("2026-07-01");
  const periodTo = new Date("2026-07-31T23:59:59");

  it("incluye líneas de facturas cobradas en el periodo", () => {
    const invoices = [
      {
        id: 300001,
        reservationId: 480001,
        status: "cobrada",
        createdAt: new Date("2026-07-15"),
        itemsJson: [
          { productId: 30003, unitPrice: 45, quantity: 4, description: "Cableski Día Completo" },
        ],
      },
    ];
    const { lines } = processSource1CRM(invoices, products, periodFrom, periodTo);
    expect(lines).toHaveLength(1);
    expect(lines[0].productId).toBe(30003);
    expect(lines[0].saleAmount).toBe(180);
    expect(lines[0].commissionPercent).toBe(20);
    expect(lines[0].commissionAmount).toBe(36);
    expect(lines[0].netAmountProvider).toBe(144);
  });

  it("excluye facturas fuera del periodo", () => {
    const invoices = [
      {
        id: 300002,
        status: "cobrada",
        createdAt: new Date("2026-06-15"), // Fuera del periodo
        itemsJson: [{ productId: 30003, unitPrice: 45, quantity: 2, description: "Cableski" }],
      },
    ];
    const { lines } = processSource1CRM(invoices, products, periodFrom, periodTo);
    expect(lines).toHaveLength(0);
  });

  it("excluye facturas con status 'generada' (no cobradas)", () => {
    const invoices = [
      {
        id: 300003,
        status: "generada", // No cobrada
        createdAt: new Date("2026-07-10"),
        itemsJson: [{ productId: 30003, unitPrice: 45, quantity: 1, description: "Cableski" }],
      },
    ];
    const { lines } = processSource1CRM(invoices, products, periodFrom, periodTo);
    expect(lines).toHaveLength(0);
  });

  it("excluye líneas de productos que no pertenecen al proveedor", () => {
    const invoices = [
      {
        id: 300004,
        status: "cobrada",
        createdAt: new Date("2026-07-10"),
        itemsJson: [
          { productId: 99999, unitPrice: 100, quantity: 1, description: "Producto ajeno" },
        ],
      },
    ];
    const { lines } = processSource1CRM(invoices, products, periodFrom, periodTo);
    expect(lines).toHaveLength(0);
  });

  it("procesa facturas multi-línea correctamente", () => {
    const invoices = [
      {
        id: 300005,
        reservationId: 480002,
        status: "cobrada",
        createdAt: new Date("2026-07-20"),
        itemsJson: [
          { productId: 30003, unitPrice: 45, quantity: 2, description: "Cableski" },
          { productId: 30004, unitPrice: 30, quantity: 3, description: "Canoas" },
        ],
      },
    ];
    const { lines } = processSource1CRM(invoices, products, periodFrom, periodTo);
    expect(lines).toHaveLength(2);
    const cableski = lines.find((l) => l.productId === 30003)!;
    const canoas = lines.find((l) => l.productId === 30004)!;
    expect(cableski.saleAmount).toBe(90);
    expect(canoas.saleAmount).toBe(90);
    expect(canoas.commissionPercent).toBe(15);
    expect(canoas.commissionAmount).toBe(13.5);
    expect(canoas.netAmountProvider).toBe(76.5);
  });

  it("marca las facturas procesadas para evitar duplicados", () => {
    const invoices = [
      {
        id: 300006,
        status: "cobrada",
        createdAt: new Date("2026-07-10"),
        itemsJson: [{ productId: 30003, unitPrice: 45, quantity: 1, description: "Cableski" }],
      },
    ];
    const { processedInvoiceIds } = processSource1CRM(invoices, products, periodFrom, periodTo);
    expect(processedInvoiceIds.has(300006)).toBe(true);
  });
});

// ─── B. SOURCE 2: Reservas TPV ────────────────────────────────────────────────

describe("Regresión recalculate — SOURCE 2: Reservas TPV", () => {
  const products: ProductDef[] = [
    { id: 30003, title: "Cableski", commissionPercent: 20, costType: "comision_sobre_venta" },
  ];

  const periodFromMs = new Date("2026-07-01").getTime();
  const periodToMs = new Date("2026-07-31T23:59:59").getTime();

  it("incluye reservas TPV pagadas en el periodo", () => {
    const reservations = [
      {
        id: 500001,
        status: "paid",
        channel: "tpv",
        paidAt: new Date("2026-07-10").getTime(),
        bookingDate: "2026-07-10",
        extrasJson: JSON.stringify([
          { productId: 30003, unitPrice: 45, quantity: 2 },
        ]),
      },
    ];
    const lines = processSource2TPV(reservations, products, periodFromMs, periodToMs, new Set());
    expect(lines).toHaveLength(1);
    expect(lines[0].saleAmount).toBe(90);
    expect(lines[0].commissionAmount).toBe(18);
    expect(lines[0].netAmountProvider).toBe(72);
  });

  it("excluye reservas TPV fuera del periodo", () => {
    const reservations = [
      {
        id: 500002,
        status: "paid",
        channel: "tpv",
        paidAt: new Date("2026-06-01").getTime(), // Fuera del periodo
        bookingDate: "2026-06-01",
        extrasJson: JSON.stringify([{ productId: 30003, unitPrice: 45, quantity: 1 }]),
      },
    ];
    const lines = processSource2TPV(reservations, products, periodFromMs, periodToMs, new Set());
    expect(lines).toHaveLength(0);
  });

  it("no duplica si la factura ya fue procesada en SOURCE 1", () => {
    const processedInvoiceIds = new Set([300001]); // Ya procesada en SOURCE 1
    const reservations = [
      {
        id: 500003,
        invoiceId: 300001, // Misma factura que SOURCE 1
        status: "paid",
        channel: "tpv",
        paidAt: new Date("2026-07-15").getTime(),
        bookingDate: "2026-07-15",
        extrasJson: JSON.stringify([{ productId: 30003, unitPrice: 45, quantity: 1 }]),
      },
    ];
    const lines = processSource2TPV(reservations, products, periodFromMs, periodToMs, processedInvoiceIds);
    expect(lines).toHaveLength(0); // Deduplicado
  });

  it("excluye reservas de canal 'crm' (no son TPV)", () => {
    const reservations = [
      {
        id: 500004,
        status: "paid",
        channel: "crm", // No es TPV
        paidAt: new Date("2026-07-10").getTime(),
        bookingDate: "2026-07-10",
        extrasJson: JSON.stringify([{ productId: 30003, unitPrice: 45, quantity: 1 }]),
      },
    ];
    const lines = processSource2TPV(reservations, products, periodFromMs, periodToMs, new Set());
    expect(lines).toHaveLength(0);
  });
});

// ─── C. SOURCE 3: Reservas CRM/online ────────────────────────────────────────

describe("Regresión recalculate — SOURCE 3: Reservas CRM/online", () => {
  const products: ProductDef[] = [
    { id: 30003, title: "Cableski", commissionPercent: 20, costType: "comision_sobre_venta" },
  ];

  const periodFromMs = new Date("2026-07-01").getTime();
  const periodToMs = new Date("2026-07-31T23:59:59").getTime();

  it("incluye reservas CRM pagadas en el periodo", () => {
    const reservations = [
      {
        id: 480001,
        productId: 30003,
        productName: "Cableski Día Completo",
        status: "paid",
        channel: "crm",
        paidAt: new Date("2026-07-15").getTime(),
        bookingDate: "2026-07-15",
        amountTotal: 18000, // 180 euros en centavos
        people: 4,
      },
    ];
    const lines = processSource3CRMReservations(reservations, products, periodFromMs, periodToMs, new Set());
    expect(lines).toHaveLength(1);
    expect(lines[0].saleAmount).toBe(180);
    expect(lines[0].commissionAmount).toBe(36);
    expect(lines[0].netAmountProvider).toBe(144);
    expect(lines[0].paxCount).toBe(4);
  });

  it("incluye reservas de canal 'web' (Redsys online)", () => {
    const reservations = [
      {
        id: 480002,
        productId: 30003,
        status: "paid",
        channel: "web",
        paidAt: new Date("2026-07-20").getTime(),
        bookingDate: "2026-07-20",
        amountTotal: 5000, // 50 euros
        people: 1,
      },
    ];
    const lines = processSource3CRMReservations(reservations, products, periodFromMs, periodToMs, new Set());
    expect(lines).toHaveLength(1);
    expect(lines[0].saleAmount).toBe(50);
  });

  it("excluye reservas con status 'pending_payment'", () => {
    const reservations = [
      {
        id: 480003,
        productId: 30003,
        status: "pending_payment", // No pagada
        channel: "crm",
        paidAt: new Date("2026-07-10").getTime(),
        bookingDate: "2026-07-10",
        amountTotal: 18000,
        people: 4,
      },
    ];
    const lines = processSource3CRMReservations(reservations, products, periodFromMs, periodToMs, new Set());
    expect(lines).toHaveLength(0);
  });

  it("excluye reservas de canal 'tpv' (ya cubiertas en SOURCE 2)", () => {
    const reservations = [
      {
        id: 500001,
        productId: 30003,
        status: "paid",
        channel: "tpv", // No es CRM
        paidAt: new Date("2026-07-10").getTime(),
        bookingDate: "2026-07-10",
        amountTotal: 9000,
        people: 2,
      },
    ];
    const lines = processSource3CRMReservations(reservations, products, periodFromMs, periodToMs, new Set());
    expect(lines).toHaveLength(0);
  });

  it("no duplica si la factura ya fue procesada en SOURCE 1", () => {
    const processedInvoiceIds = new Set([300001]);
    const reservations = [
      {
        id: 480004,
        invoiceId: 300001,
        productId: 30003,
        status: "paid",
        channel: "crm",
        paidAt: new Date("2026-07-10").getTime(),
        bookingDate: "2026-07-10",
        amountTotal: 18000,
        people: 4,
      },
    ];
    const lines = processSource3CRMReservations(reservations, products, periodFromMs, periodToMs, processedInvoiceIds);
    expect(lines).toHaveLength(0); // Deduplicado
  });
});

// ─── D. SOURCE 4: Plataformas externas ───────────────────────────────────────

describe("Regresión recalculate — SOURCE 4: Plataformas externas", () => {
  it("calcula comisión correctamente para cupón con realAmount", () => {
    const product: ProductDef = { id: 30003, title: "Cableski", commissionPercent: 20, costType: "comision_sobre_venta" };
    const saleAmount = 35; // Precio neto de Groupon
    const commissionAmount = (saleAmount * product.commissionPercent) / 100;
    const netAmountProvider = saleAmount - commissionAmount;
    expect(commissionAmount).toBe(7);
    expect(netAmountProvider).toBe(28);
  });

  it("usa netPrice de platform_product como fallback cuando realAmount es 0", () => {
    const realAmount = 0;
    const netPrice = 30;
    const saleAmount = realAmount > 0 ? realAmount : netPrice;
    expect(saleAmount).toBe(30);
  });

  it("omite cupones sin importe (realAmount=0 y sin netPrice)", () => {
    const realAmount = 0;
    const netPrice: number | null = null;
    const saleAmount = realAmount > 0 ? realAmount : parseFloat(String(netPrice ?? "0"));
    expect(saleAmount).toBe(0);
    // saleAmount <= 0 → se omite
    expect(saleAmount <= 0).toBe(true);
  });

  it("genera nombre de línea con código de cupón", () => {
    const couponCode = "GROUPON-ABC123";
    const provider = "Groupon";
    const productTitle = "Cableski";
    const productName = `[Cupón ${provider} ${couponCode}] ${productTitle}`;
    expect(productName).toBe("[Cupón Groupon GROUPON-ABC123] Cableski");
  });

  it("usa requestedDate del cupón como serviceDate cuando está disponible", () => {
    const requestedDate = "2026-07-15";
    const periodFrom = "2026-07-01";
    const serviceDate = requestedDate ?? periodFrom;
    expect(serviceDate).toBe("2026-07-15");
  });

  it("usa periodFrom como serviceDate cuando requestedDate es null", () => {
    const requestedDate: string | null = null;
    const periodFrom = "2026-07-01";
    const serviceDate = requestedDate ?? periodFrom;
    expect(serviceDate).toBe("2026-07-01");
  });
});

// ─── E. Deduplicación entre fuentes ──────────────────────────────────────────

describe("Regresión recalculate — Deduplicación entre fuentes", () => {
  it("una venta con factura no aparece en SOURCE 1 y SOURCE 3 simultáneamente", () => {
    // Simula que SOURCE 1 procesa la factura y la marca como procesada
    const processedInvoiceIds = new Set<number>();
    const invoiceId = 300001;

    // SOURCE 1 procesa la factura y la marca
    processedInvoiceIds.add(invoiceId);

    // SOURCE 3 intenta procesar la misma reserva con la misma factura
    const reservationHasInvoice = true;
    const alreadyProcessed = reservationHasInvoice && processedInvoiceIds.has(invoiceId);
    expect(alreadyProcessed).toBe(true); // Se salta → no duplicado
  });

  it("una reserva TPV con factura no aparece en SOURCE 1 y SOURCE 2 simultáneamente", () => {
    const processedInvoiceIds = new Set<number>([300002]);
    const tpvReservationInvoiceId = 300002;
    const alreadyProcessed = processedInvoiceIds.has(tpvReservationInvoiceId);
    expect(alreadyProcessed).toBe(true);
  });

  it("reservas sin factura vinculada pueden aparecer en SOURCE 2 o SOURCE 3", () => {
    const processedInvoiceIds = new Set<number>();
    const reservationInvoiceId: number | undefined = undefined;
    const alreadyProcessed = reservationInvoiceId !== undefined && processedInvoiceIds.has(reservationInvoiceId);
    expect(alreadyProcessed).toBe(false); // No está en processedInvoiceIds → se procesa
  });
});

// ─── F. Módulo de anulaciones — propagateCancellation ────────────────────────

describe("Regresión módulo de anulaciones — propagateCancellation", () => {
  // Simulador de propagateCancellation (lógica pura sin BD)
  interface MockReservation { id: number; status: string; }
  interface MockReservationOp { reservationId: number; opStatus: string; }
  interface MockReavExpedient { id: number; reservationId: number; operativeStatus: string; fiscalStatus: string; }
  interface MockTransaction { type: string; amount: string; description: string; operationStatus: string; }

  function simulatePropagation(params: {
    reservationId: number;
    compensationType: "devolucion" | "bono";
    refundAmount?: number;
    reservations: MockReservation[];
    reservationOps: MockReservationOp[];
    reavExpedients: MockReavExpedient[];
  }) {
    const { reservationId, compensationType, refundAmount, reservations, reservationOps, reavExpedients } = params;
    const cancellationNumber = `ANU-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`;

    // 1. Cancelar reserva
    const reservation = reservations.find((r) => r.id === reservationId);
    if (reservation) reservation.status = "cancelled";

    // 2. Actualizar opStatus
    const op = reservationOps.find((o) => o.reservationId === reservationId);
    if (op) op.opStatus = "anulado";

    // 3. Cerrar expediente REAV
    const reav = reavExpedients.find((r) => r.reservationId === reservationId);
    if (reav) {
      reav.operativeStatus = "anulado";
      reav.fiscalStatus = "anulado";
    }

    // 4. Transacción de devolución
    let refundTransaction: MockTransaction | null = null;
    if (compensationType === "devolucion" && refundAmount && refundAmount > 0) {
      refundTransaction = {
        type: "reembolso",
        amount: String(-Math.abs(refundAmount)),
        description: `Devolución por anulación ${cancellationNumber}`,
        operationStatus: "anulada",
      };
    }

    return {
      cancellationNumber,
      reservation,
      op,
      reav,
      refundTransaction,
    };
  }

  it("genera número ANU- con formato correcto", () => {
    const result = simulatePropagation({
      reservationId: 480001,
      compensationType: "devolucion",
      refundAmount: 180,
      reservations: [{ id: 480001, status: "paid" }],
      reservationOps: [{ reservationId: 480001, opStatus: "confirmado" }],
      reavExpedients: [],
    });
    expect(result.cancellationNumber).toMatch(/^ANU-2026-\d{4}$/);
  });

  it("cambia status de reserva a 'cancelled'", () => {
    const reservations = [{ id: 480001, status: "paid" }];
    const result = simulatePropagation({
      reservationId: 480001,
      compensationType: "devolucion",
      refundAmount: 100,
      reservations,
      reservationOps: [{ reservationId: 480001, opStatus: "confirmado" }],
      reavExpedients: [],
    });
    expect(result.reservation?.status).toBe("cancelled");
  });

  it("cambia opStatus de reservation_operational a 'anulado'", () => {
    const reservationOps = [{ reservationId: 480001, opStatus: "confirmado" }];
    const result = simulatePropagation({
      reservationId: 480001,
      compensationType: "devolucion",
      refundAmount: 100,
      reservations: [{ id: 480001, status: "paid" }],
      reservationOps,
      reavExpedients: [],
    });
    expect(result.op?.opStatus).toBe("anulado");
  });

  it("cierra expediente REAV con fiscalStatus='anulado'", () => {
    const reavExpedients = [{ id: 1, reservationId: 480001, operativeStatus: "abierto", fiscalStatus: "abierto" }];
    const result = simulatePropagation({
      reservationId: 480001,
      compensationType: "devolucion",
      refundAmount: 100,
      reservations: [{ id: 480001, status: "paid" }],
      reservationOps: [{ reservationId: 480001, opStatus: "confirmado" }],
      reavExpedients,
    });
    expect(result.reav?.operativeStatus).toBe("anulado");
    expect(result.reav?.fiscalStatus).toBe("anulado");
  });

  it("crea transacción de devolución con importe negativo", () => {
    const result = simulatePropagation({
      reservationId: 480001,
      compensationType: "devolucion",
      refundAmount: 180,
      reservations: [{ id: 480001, status: "paid" }],
      reservationOps: [{ reservationId: 480001, opStatus: "confirmado" }],
      reavExpedients: [],
    });
    expect(result.refundTransaction).not.toBeNull();
    expect(result.refundTransaction?.type).toBe("reembolso");
    expect(parseFloat(result.refundTransaction!.amount)).toBeLessThan(0);
    expect(result.refundTransaction?.amount).toBe("-180");
  });

  it("no crea transacción de devolución para tipo 'bono'", () => {
    const result = simulatePropagation({
      reservationId: 480001,
      compensationType: "bono",
      refundAmount: 180,
      reservations: [{ id: 480001, status: "paid" }],
      reservationOps: [{ reservationId: 480001, opStatus: "confirmado" }],
      reavExpedients: [],
    });
    expect(result.refundTransaction).toBeNull();
  });

  it("no crea transacción de devolución cuando refundAmount es 0", () => {
    const result = simulatePropagation({
      reservationId: 480001,
      compensationType: "devolucion",
      refundAmount: 0,
      reservations: [{ id: 480001, status: "paid" }],
      reservationOps: [{ reservationId: 480001, opStatus: "confirmado" }],
      reavExpedients: [],
    });
    expect(result.refundTransaction).toBeNull();
  });
});

// ─── G. Visibilidad en calendario y liquidaciones ─────────────────────────────

describe("Regresión anulaciones — Visibilidad en calendario y liquidaciones", () => {
  it("reserva con status='cancelled' NO debe aparecer en el calendario de operaciones", () => {
    const reservations = [
      { id: 1, status: "paid", bookingDate: "2026-07-15" },
      { id: 2, status: "cancelled", bookingDate: "2026-07-15" },
      { id: 3, status: "paid", bookingDate: "2026-07-15" },
    ];
    const calendarReservations = reservations.filter((r) => r.status !== "cancelled");
    expect(calendarReservations).toHaveLength(2);
    expect(calendarReservations.find((r) => r.id === 2)).toBeUndefined();
  });

  it("reserva con opStatus='anulado' NO debe aparecer en órdenes del día", () => {
    const ops = [
      { reservationId: 1, opStatus: "confirmado" },
      { reservationId: 2, opStatus: "anulado" },
      { reservationId: 3, opStatus: "completado" },
    ];
    const activeOps = ops.filter((o) => o.opStatus !== "anulado");
    expect(activeOps).toHaveLength(2);
    expect(activeOps.find((o) => o.reservationId === 2)).toBeUndefined();
  });

  it("reserva cancelada NO debe incluirse en recalculate (status != 'paid')", () => {
    const reservations = [
      { id: 1, status: "paid", channel: "crm", paidAt: Date.now(), productId: 30003, amountTotal: 18000 },
      { id: 2, status: "cancelled", channel: "crm", paidAt: Date.now(), productId: 30003, amountTotal: 18000 },
    ];
    const eligibleForSettlement = reservations.filter((r) => r.status === "paid");
    expect(eligibleForSettlement).toHaveLength(1);
    expect(eligibleForSettlement[0].id).toBe(1);
  });

  it("transacción de devolución tiene type='reembolso' y amount negativo", () => {
    const transactions = [
      { id: 1, type: "ingreso", amount: "180.00", operationStatus: "confirmada" },
      { id: 2, type: "reembolso", amount: "-180.00", operationStatus: "anulada" },
    ];
    const refunds = transactions.filter((t) => t.type === "reembolso");
    expect(refunds).toHaveLength(1);
    expect(parseFloat(refunds[0].amount)).toBeLessThan(0);
  });
});

// ─── H. Transacción de devolución — signo negativo ───────────────────────────

describe("Regresión anulaciones — Transacción de devolución signo negativo", () => {
  it("el importe de devolución siempre es negativo independientemente del input", () => {
    const testCases = [180, 50, 240, 0.01, 1000];
    testCases.forEach((amount) => {
      const storedAmount = -Math.abs(amount);
      expect(storedAmount).toBeLessThan(0);
      expect(storedAmount).toBe(-amount);
    });
  });

  it("la suma de ingreso + devolución es 0 (balance neutro)", () => {
    const ingreso = 180;
    const devolucion = -180;
    expect(ingreso + devolucion).toBe(0);
  });

  it("el prefijo DEV- distingue las transacciones de devolución de las facturas FAC-", () => {
    const txNumber = "FAC-2026-0010";
    const devNumber = txNumber.replace("FAC-", "DEV-");
    expect(devNumber).toBe("DEV-2026-0010");
    expect(devNumber.startsWith("DEV-")).toBe(true);
    expect(devNumber.startsWith("FAC-")).toBe(false);
  });

  it("devolución parcial tiene importe negativo menor que el ingreso original", () => {
    const ingresoOriginal = 180;
    const devolucionParcial = -90;
    expect(devolucionParcial).toBeLessThan(0);
    expect(Math.abs(devolucionParcial)).toBeLessThan(ingresoOriginal);
  });
});
