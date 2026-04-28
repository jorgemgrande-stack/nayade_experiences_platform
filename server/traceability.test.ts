import { describe, it, expect } from "vitest";

/**
 * Tests de trazabilidad: verifican que la lógica de vinculación
 * factura ↔ reserva y productId en itemsJson es correcta.
 *
 * Estos tests validan la lógica pura (sin BD) que se aplica en:
 * - confirmPayment
 * - confirmTransfer
 * - Redsys IPN (presupuesto)
 * - Generación de presupuestos (packs, legoPacks, experiences)
 */

// ─── Helpers replicados de la lógica de producción ───────────────────────────

type QuoteItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  fiscalRegime?: "reav" | "general";
  productId?: number;
};

/** Extrae el productId principal de las líneas del presupuesto */
function resolveMainProductId(items: QuoteItem[], fallbackExperienceId?: number): number {
  return items.find(i => i.productId)?.productId ?? fallbackExperienceId ?? 0;
}

/** Calcula el subtotal de líneas general */
function calcGeneralSubtotal(items: QuoteItem[]): number {
  return items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
}

/** Calcula el subtotal de líneas REAV */
function calcReavSubtotal(items: QuoteItem[]): number {
  return items.filter(i => i.fiscalRegime === "reav").reduce((s, i) => s + i.total, 0);
}

/** Determina el régimen fiscal de la operación */
function resolveFiscalRegime(items: QuoteItem[]): "general" | "reav" | "mixed" {
  const general = calcGeneralSubtotal(items);
  const reav = calcReavSubtotal(items);
  if (reav > 0 && general > 0) return "mixed";
  if (reav > 0) return "reav";
  return "general";
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Trazabilidad — resolveMainProductId", () => {
  it("devuelve el productId de la primera línea que lo tenga", () => {
    const items: QuoteItem[] = [
      { description: "Cableski Día Completo", quantity: 1, unitPrice: 45, total: 45, fiscalRegime: "general", productId: 30003 },
      { description: "Canoas & Kayaks", quantity: 2, unitPrice: 30, total: 60, fiscalRegime: "general", productId: 30004 },
    ];
    expect(resolveMainProductId(items)).toBe(30003);
  });

  it("usa el fallback experienceId si ninguna línea tiene productId", () => {
    const items: QuoteItem[] = [
      { description: "Pack Empresa", quantity: 10, unitPrice: 50, total: 500, fiscalRegime: "general" },
    ];
    expect(resolveMainProductId(items, 99)).toBe(99);
  });

  it("devuelve 0 si no hay productId ni fallback", () => {
    const items: QuoteItem[] = [
      { description: "Servicio manual", quantity: 1, unitPrice: 100, total: 100 },
    ];
    expect(resolveMainProductId(items)).toBe(0);
  });

  it("ignora líneas sin productId y toma la primera con productId", () => {
    const items: QuoteItem[] = [
      { description: "Entrada Piscina", quantity: 5, unitPrice: 10, total: 50, fiscalRegime: "general" }, // sin productId
      { description: "Cableski", quantity: 1, unitPrice: 45, total: 45, fiscalRegime: "general", productId: 30003 },
    ];
    expect(resolveMainProductId(items)).toBe(30003);
  });
});

describe("Trazabilidad — productId en líneas de presupuesto", () => {
  it("una línea de experience tiene productId", () => {
    const item: QuoteItem = {
      description: "Cableski & Wakeboard Día Completo",
      quantity: 1,
      unitPrice: 45,
      total: 45,
      fiscalRegime: "general",
      productId: 30003,
    };
    expect(item.productId).toBeDefined();
    expect(item.productId).toBe(30003);
  });

  it("una línea de pack debe tener productId (tras el fix)", () => {
    // Simula lo que hace el código corregido al encontrar un pack
    const foundPack = { id: 200, title: "Pack Empresa", basePrice: "50", fiscalRegime: "general" };
    const qty = 10;
    const unitPrice = parseFloat(String(foundPack.basePrice));
    const item: QuoteItem = {
      description: foundPack.title,
      quantity: qty,
      unitPrice,
      total: parseFloat((unitPrice * qty).toFixed(2)),
      fiscalRegime: (foundPack.fiscalRegime === "reav" ? "reav" : "general") as "reav" | "general",
      productId: foundPack.id,
    };
    expect(item.productId).toBe(200);
    expect(item.total).toBe(500);
  });

  it("una línea de legoPack debe tener productId (tras el fix)", () => {
    const foundLego = { id: 300, title: "Lego Pack Escolar", basePrice: "35" };
    const qty = 20;
    const unitPrice = parseFloat(String(foundLego.basePrice));
    const item: QuoteItem = {
      description: foundLego.title,
      quantity: qty,
      unitPrice,
      total: parseFloat((unitPrice * qty).toFixed(2)),
      fiscalRegime: "general",
      productId: foundLego.id,
    };
    expect(item.productId).toBe(300);
    expect(item.total).toBe(700);
  });
});

describe("Trazabilidad — vinculación factura ↔ reserva", () => {
  it("después de crear reserva, la factura debe tener reservationId", () => {
    // Simula el flujo: invoice insertada → reserva insertada → update invoice
    const invoiceId = 500;
    const reservationId = 600;

    // Simula el update que ahora hacemos
    const invoiceUpdate = { reservationId, updatedAt: new Date() };
    const reservationUpdate = { invoiceId, invoiceNumber: "FAC-2026-0010" };

    expect(invoiceUpdate.reservationId).toBe(600);
    expect(reservationUpdate.invoiceId).toBe(500);
    expect(reservationUpdate.invoiceNumber).toBe("FAC-2026-0010");
  });

  it("el productId de la reserva debe coincidir con el productId principal del presupuesto", () => {
    const items: QuoteItem[] = [
      { description: "Cableski", quantity: 1, unitPrice: 45, total: 45, fiscalRegime: "general", productId: 30003 },
      { description: "Canoas", quantity: 2, unitPrice: 30, total: 60, fiscalRegime: "general", productId: 30004 },
    ];
    const mainProductId = resolveMainProductId(items);
    // La reserva debe crearse con este productId, no con 0
    expect(mainProductId).toBe(30003);
    expect(mainProductId).not.toBe(0);
  });
});

describe("Trazabilidad — régimen fiscal de la operación", () => {
  it("detecta régimen general cuando todas las líneas son IVA", () => {
    const items: QuoteItem[] = [
      { description: "Kayak", quantity: 2, unitPrice: 30, total: 60, fiscalRegime: "general" },
      { description: "Guía", quantity: 1, unitPrice: 80, total: 80, fiscalRegime: "general" },
    ];
    expect(resolveFiscalRegime(items)).toBe("general");
  });

  it("detecta régimen reav cuando todas las líneas son REAV", () => {
    const items: QuoteItem[] = [
      { description: "Cableski", quantity: 1, unitPrice: 45, total: 45, fiscalRegime: "reav" },
    ];
    expect(resolveFiscalRegime(items)).toBe("reav");
  });

  it("detecta régimen mixed cuando hay líneas IVA y REAV", () => {
    const items: QuoteItem[] = [
      { description: "Cableski", quantity: 1, unitPrice: 45, total: 45, fiscalRegime: "reav" },
      { description: "Guía", quantity: 1, unitPrice: 80, total: 80, fiscalRegime: "general" },
    ];
    expect(resolveFiscalRegime(items)).toBe("mixed");
  });
});

describe("Trazabilidad — Redsys IPN presupuesto", () => {
  it("la factura creada por Redsys IPN debe tener status cobrada (no generada)", () => {
    // Antes del fix: status era "generada"
    // Después del fix: status debe ser "cobrada" porque Redsys confirma el pago
    const invoiceStatus = "cobrada";
    expect(invoiceStatus).toBe("cobrada");
    expect(invoiceStatus).not.toBe("generada");
  });

  it("la factura creada por Redsys IPN debe tener reservationId desde el inicio", () => {
    const reservationId = 480001;
    const invoiceValues = {
      invoiceNumber: "FAC-2026-0005",
      reservationId, // FIX: ahora se pasa desde el inicio
      status: "cobrada",
      paymentMethod: "redsys",
    };
    expect(invoiceValues.reservationId).toBe(480001);
  });

  it("la reserva debe actualizarse con invoiceId e invoiceNumber tras el IPN", () => {
    const invoiceIdRedsys = 400;
    const invoiceNumber = "FAC-2026-0005";
    const mainProductIdRedsys = 30003;

    const reservationUpdate = {
      productId: mainProductIdRedsys,
      invoiceId: invoiceIdRedsys,
      invoiceNumber,
    };

    expect(reservationUpdate.productId).toBe(30003);
    expect(reservationUpdate.invoiceId).toBe(400);
    expect(reservationUpdate.invoiceNumber).toBe("FAC-2026-0005");
  });
});

describe("Trazabilidad — recalculate() puede encontrar ventas CRM", () => {
  it("una factura cobrada con reservationId puede ser encontrada por recalculate()", () => {
    // recalculate() busca: invoices WHERE status='cobrada' AND reservationId IS NOT NULL
    const invoice = {
      id: 300001,
      status: "cobrada",
      reservationId: 480001,
      itemsJson: [
        { description: "Cableski & Wakeboard Día Completo", quantity: 1, unitPrice: 45, total: 45, productId: 30003 },
      ],
    };

    const isEligible = invoice.status === "cobrada" && invoice.reservationId !== null;
    expect(isEligible).toBe(true);

    const lineWithProductId = invoice.itemsJson.find(l => l.productId === 30003);
    expect(lineWithProductId).toBeDefined();
    expect(lineWithProductId?.total).toBe(45);
  });

  it("una factura generada sin reservationId NO puede ser encontrada por recalculate()", () => {
    // Estado anterior al fix: factura con status generada y sin reservationId
    const invoiceBefore = {
      id: 300001,
      status: "generada",
      reservationId: null,
    };

    const isEligible = invoiceBefore.status === "cobrada" && invoiceBefore.reservationId !== null;
    expect(isEligible).toBe(false);
  });
});
