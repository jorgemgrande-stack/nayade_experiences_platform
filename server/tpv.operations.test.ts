import { describe, it, expect } from "vitest";

/**
 * Tests de integración TPV → Operaciones.
 * Verifica que createSale llama a postConfirmOperation con los datos correctos
 * para que las ventas TPV aparezcan en el calendario de operaciones.
 */

// ─── Tipos mock ───────────────────────────────────────────────────────────────

type TpvItem = {
  productType: string;
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  eventDate?: string;
  participants: number;
};

type TpvPayment = {
  method: "cash" | "card" | "bizum" | "other";
  amount: number;
};

type PostConfirmArgs = {
  reservationId: number;
  productId: number;
  productName: string;
  serviceDate: string;
  people: number;
  amountCents: number;
  customerName: string;
  customerEmail: string;
  totalAmount: number;
  paymentMethod: string;
  saleChannel: string;
  invoiceNumber: string;
  taxBase: number;
  taxAmount: number;
  reavMargin: number;
  fiscalRegime: string;
  description: string;
};

// ─── Simulación del flujo de createSale → postConfirmOperation ────────────────

function simulatePostConfirmArgs(
  items: TpvItem[],
  payments: TpvPayment[],
  options: {
    customerName?: string;
    customerEmail?: string;
    discountAmount?: number;
    reservationId?: number;
    saleId?: number;
    ticketNumber?: string;
    fiscalSummary?: "iva_only" | "reav_only" | "mixed";
    totalTaxBase?: number;
    totalTaxAmount?: number;
    totalReavMargin?: number;
  } = {}
): PostConfirmArgs {
  const subtotal = items.reduce((acc, item) => {
    return acc + item.unitPrice * item.quantity * (1 - item.discountPercent / 100);
  }, 0);
  const total = Math.max(0, subtotal - (options.discountAmount ?? 0));

  const mainItem = items[0];
  const primaryPaymentMethod = payments[0]?.method ?? "other";
  const serviceDate = mainItem?.eventDate ?? new Date().toISOString().split("T")[0];
  const people = items.reduce((sum, it) => sum + (it.participants ?? 1), 0);

  const fiscalSummary = options.fiscalSummary ?? "iva_only";
  const fiscalRegimeForOp = fiscalSummary === "iva_only" ? "general"
    : fiscalSummary === "reav_only" ? "reav" : "mixed";

  const opPaymentMethod = primaryPaymentMethod === "cash" ? "efectivo" : "otro";

  const reservationId = options.reservationId ?? 0;
  const saleId = options.saleId ?? 1;
  const ticketNumber = options.ticketNumber ?? "TPV-2026-0001";

  return {
    reservationId,
    productId: mainItem?.productId ?? 0,
    productName: items.length > 1
      ? `${mainItem.productName} (+${items.length - 1} más)`
      : mainItem?.productName ?? items.map(i => i.productName).join(", "),
    serviceDate,
    people,
    amountCents: Math.round(total * 100),
    customerName: options.customerName || "Cliente TPV",
    customerEmail: options.customerEmail || "",
    totalAmount: total,
    paymentMethod: opPaymentMethod,
    saleChannel: "tpv",
    invoiceNumber: ticketNumber,
    taxBase: options.totalTaxBase ?? 0,
    taxAmount: options.totalTaxAmount ?? 0,
    reavMargin: options.totalReavMargin ?? 0,
    fiscalRegime: fiscalRegimeForOp,
    description: `Venta TPV ${ticketNumber}${mainItem ? ` — ${mainItem.productName}` : ""}`,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("TPV createSale → postConfirmOperation (calendario de operaciones)", () => {

  describe("Campos básicos de la operación", () => {
    it("usa el productId y productName del primer item como producto principal", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 2 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 45 }]);
      expect(args.productId).toBe(30001);
      expect(args.productName).toBe("Wakeboard");
    });

    it("usa el eventDate del primer item como serviceDate", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, eventDate: "2026-07-15", participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 45 }]);
      expect(args.serviceDate).toBe("2026-07-15");
    });

    it("usa la fecha de hoy si no hay eventDate", () => {
      const today = new Date().toISOString().split("T")[0];
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 45 }]);
      expect(args.serviceDate).toBe(today);
    });

    it("suma los participants de todos los items como people", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 3 },
        { productType: "experience", productId: 30002, productName: "Canoa", quantity: 1, unitPrice: 30, discountPercent: 0, participants: 2 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 75 }]);
      expect(args.people).toBe(5);
    });

    it("calcula amountCents correctamente desde el total", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 2, unitPrice: 45, discountPercent: 0, participants: 2 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 90 }]);
      expect(args.amountCents).toBe(9000); // 90€ × 100
    });

    it("aplica descuento global al calcular amountCents", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 100, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 90 }], { discountAmount: 10 });
      expect(args.amountCents).toBe(9000); // 100 - 10 = 90€
    });
  });

  describe("Canal y método de pago", () => {
    it("saleChannel siempre es 'tpv'", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 45 }]);
      expect(args.saleChannel).toBe("tpv");
    });

    it("mapea 'cash' a 'efectivo'", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "cash", amount: 45 }]);
      expect(args.paymentMethod).toBe("efectivo");
    });

    it("mapea 'card', 'bizum' y 'other' a 'otro'", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
      ];
      for (const method of ["card", "bizum", "other"] as const) {
        const args = simulatePostConfirmArgs(items, [{ method, amount: 45 }]);
        expect(args.paymentMethod).toBe("otro");
      }
    });
  });

  describe("Régimen fiscal", () => {
    it("mapea 'iva_only' a 'general'", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 45 }], { fiscalSummary: "iva_only", totalTaxBase: 37.19, totalTaxAmount: 7.81 });
      expect(args.fiscalRegime).toBe("general");
      expect(args.taxBase).toBe(37.19);
      expect(args.reavMargin).toBe(0);
    });

    it("mapea 'reav_only' a 'reav'", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30002, productName: "Canoa REAV", quantity: 1, unitPrice: 80, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 80 }], { fiscalSummary: "reav_only", totalReavMargin: 32 });
      expect(args.fiscalRegime).toBe("reav");
      expect(args.reavMargin).toBe(32);
    });

    it("mapea 'mixed' a 'mixed'", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
        { productType: "experience", productId: 30002, productName: "Canoa REAV", quantity: 1, unitPrice: 80, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 125 }], {
        fiscalSummary: "mixed", totalTaxBase: 37.19, totalTaxAmount: 7.81, totalReavMargin: 32,
      });
      expect(args.fiscalRegime).toBe("mixed");
      expect(args.taxBase).toBe(37.19);
      expect(args.reavMargin).toBe(32);
    });
  });

  describe("Descripción y referencia del ticket", () => {
    it("incluye el ticketNumber en la descripción", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 45 }], { ticketNumber: "TPV-2026-0042" });
      expect(args.description).toContain("TPV-2026-0042");
      expect(args.invoiceNumber).toBe("TPV-2026-0042");
    });

    it("incluye el nombre del producto principal en la descripción", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard Pro", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 45 }], { ticketNumber: "TPV-2026-0043" });
      expect(args.description).toContain("Wakeboard Pro");
    });

    it("usa 'Cliente TPV' cuando no se proporciona customerName", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 45 }]);
      expect(args.customerName).toBe("Cliente TPV");
    });

    it("usa el customerName real cuando se proporciona", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 45 }], { customerName: "María García" });
      expect(args.customerName).toBe("María García");
    });
  });

  describe("Ticket multi-producto", () => {
    it("el productName incluye el sufijo (+N más) para tickets con múltiples productos", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
        { productType: "experience", productId: 30002, productName: "Canoa", quantity: 1, unitPrice: 30, discountPercent: 0, participants: 1 },
        { productType: "spa", productId: 40001, productName: "Masaje", quantity: 1, unitPrice: 60, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 135 }]);
      expect(args.productName).toContain("Wakeboard");
      expect(args.productName).toContain("+2 más");
    });

    it("el productId es siempre el del primer item (producto principal)", () => {
      const items: TpvItem[] = [
        { productType: "experience", productId: 30001, productName: "Wakeboard", quantity: 1, unitPrice: 45, discountPercent: 0, participants: 1 },
        { productType: "spa", productId: 40001, productName: "Masaje", quantity: 1, unitPrice: 60, discountPercent: 0, participants: 1 },
      ];
      const args = simulatePostConfirmArgs(items, [{ method: "card", amount: 105 }]);
      expect(args.productId).toBe(30001);
    });
  });
});
