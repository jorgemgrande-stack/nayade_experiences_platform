/**
 * Tests: SOURCE 4 — Plataformas externas en recalculate()
 * Verifica que los cupones de plataformas externas (Groupon, Smartbox, etc.)
 * se incluyen correctamente en las liquidaciones de proveedores.
 */
import { describe, it, expect } from "vitest";

// ── Helpers de lógica pura (sin BD) ──────────────────────────────────────────

interface ProductDef {
  id: number;
  title: string;
  commissionPercent: number;
  costType: string;
}

interface CouponRow {
  id: number;
  provider: string;
  couponCode: string;
  productRealId: number | null;
  platformProductId: number | null;
  realAmount: string | null;
  requestedDate: string | null;
  reservationId: number | null;
  participants: number;
}

interface PlatformProductRow {
  id: number;
  experienceId: number | null;
  netPrice: string | null;
}

interface PlatformSettlementRow {
  id: number;
  platformId: number;
  status: string;
  couponIds: number[];
  periodFrom: string | null;
  paidAt: Date | null;
}

interface SettlementLine {
  reservationId?: number;
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

/**
 * Extrae la lógica pura de SOURCE 4 para testearla sin BD
 */
function processSource4(
  paidPlatformSettlements: PlatformSettlementRow[],
  couponsBySettlement: Map<number, CouponRow[]>,
  platformProductsMap: Map<number, PlatformProductRow>,
  productIds: ProductDef[],
  periodFrom: string
): SettlementLine[] {
  const productIdSet = new Set(productIds.map((p) => p.id));
  const newLines: SettlementLine[] = [];

  for (const ps of paidPlatformSettlements) {
    const couponIds = ps.couponIds ?? [];
    if (couponIds.length === 0) continue;

    const coupons = couponsBySettlement.get(ps.id) ?? [];

    for (const coupon of coupons) {
      // Determinar productId del proveedor
      let matchProductId: number | null = coupon.productRealId ?? null;

      if (!matchProductId && coupon.platformProductId) {
        const pp = platformProductsMap.get(coupon.platformProductId);
        matchProductId = pp?.experienceId ?? null;
      }

      if (!matchProductId || !productIdSet.has(matchProductId)) continue;

      const match = productIds.find((p) => p.id === matchProductId);
      if (!match) continue;

      // Importe: realAmount del cupón, o netPrice del platform_product
      let saleAmount = parseFloat(String(coupon.realAmount ?? "0"));
      if (saleAmount <= 0 && coupon.platformProductId) {
        const pp = platformProductsMap.get(coupon.platformProductId);
        saleAmount = parseFloat(String(pp?.netPrice ?? "0"));
      }
      if (saleAmount <= 0) continue;

      const commissionAmount = (saleAmount * match.commissionPercent) / 100;
      const serviceDate = coupon.requestedDate ?? ps.periodFrom ?? periodFrom;

      newLines.push({
        reservationId: coupon.reservationId ?? undefined,
        productId: match.id,
        productName: coupon.couponCode
          ? `[Cupón ${coupon.provider} ${coupon.couponCode}] ${match.title}`
          : match.title,
        serviceDate: typeof serviceDate === "string" ? serviceDate.slice(0, 10) : periodFrom,
        paxCount: coupon.participants ?? 1,
        saleAmount,
        commissionPercent: match.commissionPercent,
        commissionAmount,
        netAmountProvider: saleAmount - commissionAmount,
        costType: match.costType,
      });
    }
  }

  return newLines;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SOURCE 4 — Platform settlements in recalculate()", () => {
  const products: ProductDef[] = [
    { id: 30003, title: "Cableski & Wakeboard", commissionPercent: 20, costType: "comision_sobre_venta" },
    { id: 30004, title: "Kayak Tour", commissionPercent: 15, costType: "comision_sobre_venta" },
  ];

  const basePlatformSettlement: PlatformSettlementRow = {
    id: 1,
    platformId: 10,
    status: "pagada",
    couponIds: [101],
    periodFrom: "2026-03-01",
    paidAt: new Date("2026-03-15"),
  };

  const baseCoupon: CouponRow = {
    id: 101,
    provider: "Groupon",
    couponCode: "GRP-ABC123",
    productRealId: 30003,
    platformProductId: null,
    realAmount: "36.00",
    requestedDate: "2026-03-10",
    reservationId: 480001,
    participants: 2,
  };

  const basePlatformProduct: PlatformProductRow = {
    id: 201,
    experienceId: 30003,
    netPrice: "36.00",
  };

  it("genera una línea de liquidación para un cupón Groupon con productRealId directo", () => {
    const lines = processSource4(
      [basePlatformSettlement],
      new Map([[1, [baseCoupon]]]),
      new Map([[201, basePlatformProduct]]),
      products,
      "2026-03-01"
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].productId).toBe(30003);
    expect(lines[0].saleAmount).toBe(36);
    expect(lines[0].commissionPercent).toBe(20);
    expect(lines[0].commissionAmount).toBeCloseTo(7.2);
    expect(lines[0].netAmountProvider).toBeCloseTo(28.8);
    expect(lines[0].productName).toContain("GRP-ABC123");
    expect(lines[0].productName).toContain("Groupon");
    expect(lines[0].serviceDate).toBe("2026-03-10");
    expect(lines[0].reservationId).toBe(480001);
    expect(lines[0].paxCount).toBe(2);
  });

  it("resuelve el productId via platformProductId cuando productRealId es null", () => {
    const couponViaProduct: CouponRow = {
      ...baseCoupon,
      productRealId: null,
      platformProductId: 201,
    };

    const lines = processSource4(
      [basePlatformSettlement],
      new Map([[1, [couponViaProduct]]]),
      new Map([[201, basePlatformProduct]]),
      products,
      "2026-03-01"
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].productId).toBe(30003);
    expect(lines[0].saleAmount).toBe(36);
  });

  it("usa netPrice del platform_product cuando realAmount es null o 0", () => {
    const couponNoAmount: CouponRow = {
      ...baseCoupon,
      productRealId: null,
      platformProductId: 201,
      realAmount: null,
    };

    const lines = processSource4(
      [basePlatformSettlement],
      new Map([[1, [couponNoAmount]]]),
      new Map([[201, { ...basePlatformProduct, netPrice: "40.00" }]]),
      products,
      "2026-03-01"
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].saleAmount).toBe(40);
    expect(lines[0].commissionAmount).toBeCloseTo(8);
    expect(lines[0].netAmountProvider).toBeCloseTo(32);
  });

  it("omite cupones cuyo productId no pertenece al proveedor actual", () => {
    const couponOtherProduct: CouponRow = {
      ...baseCoupon,
      productRealId: 99999, // No está en productIds del proveedor
    };

    const lines = processSource4(
      [basePlatformSettlement],
      new Map([[1, [couponOtherProduct]]]),
      new Map(),
      products,
      "2026-03-01"
    );

    expect(lines).toHaveLength(0);
  });

  it("omite cupones con saleAmount = 0 y sin netPrice", () => {
    const couponZeroAmount: CouponRow = {
      ...baseCoupon,
      realAmount: "0.00",
      platformProductId: null,
    };

    const lines = processSource4(
      [basePlatformSettlement],
      new Map([[1, [couponZeroAmount]]]),
      new Map(),
      products,
      "2026-03-01"
    );

    expect(lines).toHaveLength(0);
  });

  it("omite liquidaciones de plataforma sin couponIds", () => {
    const settlementNoCoupons: PlatformSettlementRow = {
      ...basePlatformSettlement,
      couponIds: [],
    };

    const lines = processSource4(
      [settlementNoCoupons],
      new Map(),
      new Map(),
      products,
      "2026-03-01"
    );

    expect(lines).toHaveLength(0);
  });

  it("procesa múltiples cupones de distintos productos en la misma liquidación", () => {
    const coupon2: CouponRow = {
      id: 102,
      provider: "Smartbox",
      couponCode: "SMB-XYZ789",
      productRealId: 30004,
      platformProductId: null,
      realAmount: "50.00",
      requestedDate: "2026-03-12",
      reservationId: null,
      participants: 3,
    };

    const settlement2: PlatformSettlementRow = {
      ...basePlatformSettlement,
      couponIds: [101, 102],
    };

    const lines = processSource4(
      [settlement2],
      new Map([[1, [baseCoupon, coupon2]]]),
      new Map(),
      products,
      "2026-03-01"
    );

    expect(lines).toHaveLength(2);
    const cableskiLine = lines.find((l) => l.productId === 30003);
    const kayakLine = lines.find((l) => l.productId === 30004);
    expect(cableskiLine).toBeDefined();
    expect(kayakLine).toBeDefined();
    expect(cableskiLine!.saleAmount).toBe(36);
    expect(kayakLine!.saleAmount).toBe(50);
    expect(kayakLine!.commissionPercent).toBe(15);
    expect(kayakLine!.commissionAmount).toBeCloseTo(7.5);
    expect(kayakLine!.netAmountProvider).toBeCloseTo(42.5);
    expect(kayakLine!.paxCount).toBe(3);
  });

  it("usa periodFrom de la liquidación cuando requestedDate es null", () => {
    const couponNoDate: CouponRow = {
      ...baseCoupon,
      requestedDate: null,
    };

    const lines = processSource4(
      [basePlatformSettlement],
      new Map([[1, [couponNoDate]]]),
      new Map(),
      products,
      "2026-03-01"
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].serviceDate).toBe("2026-03-01");
  });

  it("no genera líneas si no hay liquidaciones de plataforma en el periodo", () => {
    const lines = processSource4(
      [],
      new Map(),
      new Map(),
      products,
      "2026-03-01"
    );

    expect(lines).toHaveLength(0);
  });

  it("calcula correctamente comisión del 15% para Kayak Tour", () => {
    const kayakCoupon: CouponRow = {
      ...baseCoupon,
      id: 103,
      productRealId: 30004,
      realAmount: "60.00",
      couponCode: "SMB-KAYAK001",
      provider: "Smartbox",
    };

    const settlement: PlatformSettlementRow = {
      ...basePlatformSettlement,
      couponIds: [103],
    };

    const lines = processSource4(
      [settlement],
      new Map([[1, [kayakCoupon]]]),
      new Map(),
      products,
      "2026-03-01"
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].commissionPercent).toBe(15);
    expect(lines[0].commissionAmount).toBeCloseTo(9);
    expect(lines[0].netAmountProvider).toBeCloseTo(51);
  });

  it("incluye el código de cupón y proveedor en el nombre de la línea", () => {
    const lines = processSource4(
      [basePlatformSettlement],
      new Map([[1, [baseCoupon]]]),
      new Map(),
      products,
      "2026-03-01"
    );

    expect(lines[0].productName).toBe("[Cupón Groupon GRP-ABC123] Cableski & Wakeboard");
  });

  it("usa el título del producto cuando couponCode está vacío", () => {
    const couponNoCode: CouponRow = {
      ...baseCoupon,
      couponCode: "",
    };

    const lines = processSource4(
      [basePlatformSettlement],
      new Map([[1, [couponNoCode]]]),
      new Map(),
      products,
      "2026-03-01"
    );

    expect(lines[0].productName).toBe("Cableski & Wakeboard");
  });

  it("trunca serviceDate a YYYY-MM-DD si viene con hora", () => {
    const couponWithDateTime: CouponRow = {
      ...baseCoupon,
      requestedDate: "2026-03-10T14:30:00",
    };

    const lines = processSource4(
      [basePlatformSettlement],
      new Map([[1, [couponWithDateTime]]]),
      new Map(),
      products,
      "2026-03-01"
    );

    expect(lines[0].serviceDate).toBe("2026-03-10");
  });
});
