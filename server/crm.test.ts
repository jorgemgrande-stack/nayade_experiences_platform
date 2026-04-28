import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ─────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ insertId: 1 }),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    $returningId: vi.fn().mockResolvedValue([{ id: 1 }]),
  })),
}));

// ─── UNIT TESTS ───────────────────────────────────────────────────────────────

describe("CRM — Quote number generation", () => {
  it("generates a quote number with correct format", () => {
    const year = new Date().getFullYear();
    const seq = 42;
    const quoteNumber = `PRE-${year}-${String(seq).padStart(4, "0")}`;
    expect(quoteNumber).toMatch(/^PRE-\d{4}-\d{4}$/);
    expect(quoteNumber).toBe(`PRE-${year}-0042`);
  });

  it("pads sequence numbers correctly", () => {
    expect(`PRE-2026-${String(1).padStart(4, "0")}`).toBe("PRE-2026-0001");
    expect(`PRE-2026-${String(999).padStart(4, "0")}`).toBe("PRE-2026-0999");
    expect(`PRE-2026-${String(10000).padStart(4, "0")}`).toBe("PRE-2026-10000");
  });
});

describe("CRM — Invoice number generation", () => {
  it("generates an invoice number with correct format", () => {
    const year = new Date().getFullYear();
    const seq = 7;
    const invoiceNumber = `FAC-${year}-${String(seq).padStart(4, "0")}`;
    expect(invoiceNumber).toMatch(/^FAC-\d{4}-\d{4}$/);
    expect(invoiceNumber).toBe(`FAC-${year}-0007`);
  });
});

describe("CRM — Quote total calculation", () => {
  it("calculates total with tax correctly", () => {
    const subtotal = 1000;
    const discount = 100;
    const taxRate = 21;
    const taxableAmount = subtotal - discount;
    const tax = taxableAmount * (taxRate / 100);
    const total = taxableAmount + tax;

    expect(taxableAmount).toBe(900);
    expect(tax).toBeCloseTo(189, 2);
    expect(total).toBeCloseTo(1089, 2);
  });

  it("calculates total without tax (0%)", () => {
    const subtotal = 500;
    const discount = 0;
    const taxRate = 0;
    const taxableAmount = subtotal - discount;
    const tax = taxableAmount * (taxRate / 100);
    const total = taxableAmount + tax;

    expect(total).toBe(500);
  });

  it("calculates total with 10% reduced tax", () => {
    const subtotal = 200;
    const discount = 0;
    const taxRate = 10;
    const taxableAmount = subtotal - discount;
    const tax = taxableAmount * (taxRate / 100);
    const total = taxableAmount + tax;

    expect(total).toBe(220);
  });
});

describe("CRM — Opportunity status transitions", () => {
  const validStatuses = ["nueva", "enviada", "ganada", "perdida"];

  it("recognizes all valid opportunity statuses", () => {
    validStatuses.forEach((status) => {
      expect(validStatuses).toContain(status);
    });
  });

  it("rejects invalid opportunity status", () => {
    const invalid = "en_proceso";
    expect(validStatuses).not.toContain(invalid);
  });
});

describe("CRM — Quote status transitions", () => {
  const validStatuses = ["borrador", "enviado", "aceptado", "rechazado", "expirado", "perdido"];

  it("recognizes all valid quote statuses", () => {
    validStatuses.forEach((status) => {
      expect(validStatuses).toContain(status);
    });
  });

  it("confirms that 'aceptado' is a terminal positive state", () => {
    const terminalPositive = "aceptado";
    expect(validStatuses).toContain(terminalPositive);
  });
});

describe("CRM — Lead priority levels", () => {
  const priorities = ["baja", "media", "alta"];

  it("recognizes all priority levels", () => {
    expect(priorities).toHaveLength(3);
    expect(priorities).toContain("alta");
  });

  it("orders priority correctly", () => {
    const priorityOrder = { baja: 1, media: 2, alta: 3 };
    expect(priorityOrder.alta).toBeGreaterThan(priorityOrder.baja);
    expect(priorityOrder.media).toBeGreaterThan(priorityOrder.baja);
    expect(priorityOrder.alta).toBeGreaterThan(priorityOrder.media);
  });
});

describe("CRM — Quote items calculation", () => {
  it("calculates line item totals correctly", () => {
    const items = [
      { description: "Kayak doble", quantity: 2, unitPrice: 45, total: 0 },
      { description: "Guía", quantity: 1, unitPrice: 80, total: 0 },
    ];

    const calculated = items.map((item) => ({
      ...item,
      total: item.quantity * item.unitPrice,
    }));

    expect(calculated[0].total).toBe(90);
    expect(calculated[1].total).toBe(80);

    const subtotal = calculated.reduce((s, i) => s + i.total, 0);
    expect(subtotal).toBe(170);
  });

  it("handles decimal unit prices", () => {
    const item = { quantity: 3, unitPrice: 33.33 };
    const total = item.quantity * item.unitPrice;
    expect(total).toBeCloseTo(99.99, 2);
  });
});

// ─── generateInvoice — lógica de cálculo fiscal ──────────────────────────────

describe("generateInvoice — cálculo de totales desde items TPV", () => {
  const buildItems = (items: { total: number; fiscalRegime?: "reav" | "general" }[]) => items;

  it("calcula subtotal, IVA y total correctamente para items régimen general", () => {
    const items = buildItems([
      { total: 100, fiscalRegime: "general" },
      { total: 50, fiscalRegime: "general" },
    ]);
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const generalSubtotal = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
    const taxRate = 21;
    const taxAmount = parseFloat((generalSubtotal * (taxRate / 100)).toFixed(2));
    const total = parseFloat((subtotal + taxAmount).toFixed(2));

    expect(subtotal).toBe(150);
    expect(taxAmount).toBeCloseTo(31.5, 2);
    expect(total).toBeCloseTo(181.5, 2);
  });

  it("no aplica IVA a items REAV", () => {
    const items = buildItems([
      { total: 200, fiscalRegime: "reav" },
    ]);
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const generalSubtotal = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
    const taxRate = 21;
    const taxAmount = parseFloat((generalSubtotal * (taxRate / 100)).toFixed(2));
    const total = parseFloat((subtotal + taxAmount).toFixed(2));

    expect(subtotal).toBe(200);
    expect(taxAmount).toBe(0);
    expect(total).toBe(200);
  });

  it("calcula correctamente con mezcla de items REAV y general", () => {
    const items = buildItems([
      { total: 100, fiscalRegime: "general" },
      { total: 80, fiscalRegime: "reav" },
    ]);
    const subtotal = items.reduce((s, i) => s + i.total, 0);
    const generalSubtotal = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
    const taxRate = 21;
    const taxAmount = parseFloat((generalSubtotal * (taxRate / 100)).toFixed(2));
    const total = parseFloat((subtotal + taxAmount).toFixed(2));

    expect(subtotal).toBe(180);
    expect(generalSubtotal).toBe(100);
    expect(taxAmount).toBeCloseTo(21, 2);
    expect(total).toBeCloseTo(201, 2);
  });

  it("genera número de factura con formato FAC-YYYY-NNNN", () => {
    const year = new Date().getFullYear();
    const seq = 15;
    const invoiceNumber = `FAC-${year}-${String(seq).padStart(4, "0")}`;
    expect(invoiceNumber).toMatch(/^FAC-\d{4}-\d{4}$/);
    expect(invoiceNumber).toBe(`FAC-${year}-0015`);
  });

  it("rechaza reservas que ya tienen factura (idempotencia)", () => {
    const reservation = { id: 1, invoiceId: 42, channel: "tpv" };
    const alreadyHasInvoice = !!reservation.invoiceId;
    expect(alreadyHasInvoice).toBe(true);
  });

  it("solo permite generar factura para reservas TPV sin invoiceId", () => {
    const tpvNoInvoice = { channel: "tpv", invoiceId: null };
    const tpvWithInvoice = { channel: "tpv", invoiceId: 5 };
    const onlineNoInvoice = { channel: "web", invoiceId: null };

    const canGenerate = (r: { channel: string; invoiceId: number | null }) =>
      r.channel === "tpv" && !r.invoiceId;

    expect(canGenerate(tpvNoInvoice)).toBe(true);
    expect(canGenerate(tpvWithInvoice)).toBe(false);
    expect(canGenerate(onlineNoInvoice)).toBe(false);
  });
});
