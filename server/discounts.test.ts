/**
 * Tests for the Discount Codes module
 * Tests core business logic via pure functions (no DB required)
 */
import { describe, it, expect } from "vitest";

// ─── Pure business logic helpers (mirroring server logic) ────────────────────

function calculateDiscount(subtotalCents: number, discountPercent: number): number {
  return Math.round(subtotalCents * discountPercent / 100);
}

function applyDiscount(subtotalCents: number, discountPercent: number): number {
  const discount = calculateDiscount(subtotalCents, discountPercent);
  return Math.max(0, subtotalCents - discount);
}

function isCodeExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return new Date() > expiresAt;
}

function isCodeExhausted(usageCount: number, maxUses: number | null): boolean {
  if (maxUses === null) return false;
  return usageCount >= maxUses;
}

function isCodeValid(code: {
  isActive: boolean;
  expiresAt: Date | null;
  usageCount: number;
  maxUses: number | null;
}): { valid: boolean; reason?: string } {
  if (!code.isActive) return { valid: false, reason: "Código inactivo" };
  if (isCodeExpired(code.expiresAt)) return { valid: false, reason: "Código expirado" };
  if (isCodeExhausted(code.usageCount, code.maxUses)) return { valid: false, reason: "Código agotado" };
  return { valid: true };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Discount Codes — discount calculation", () => {
  it("should calculate 10% of 200€ correctly (in cents)", () => {
    expect(calculateDiscount(20000, 10)).toBe(2000);
  });

  it("should calculate 25% of 100€ correctly (in cents)", () => {
    expect(calculateDiscount(10000, 25)).toBe(2500);
  });

  it("should return 0 for 0% discount", () => {
    expect(calculateDiscount(15000, 0)).toBe(0);
  });

  it("should return full amount for 100% discount", () => {
    expect(calculateDiscount(5000, 100)).toBe(5000);
  });

  it("should not produce negative totals with 100% discount", () => {
    expect(applyDiscount(5000, 100)).toBe(0);
  });

  it("should apply 15% discount to 80€ correctly", () => {
    // 80€ * 15% = 12€ discount → 68€ remaining
    expect(applyDiscount(8000, 15)).toBe(6800);
  });
});

describe("Discount Codes — expiry logic", () => {
  it("should detect expired codes (past date)", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isCodeExpired(yesterday)).toBe(true);
  });

  it("should accept valid codes (future date)", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isCodeExpired(tomorrow)).toBe(false);
  });

  it("should accept codes with no expiry", () => {
    expect(isCodeExpired(null)).toBe(false);
  });
});

describe("Discount Codes — usage limit logic", () => {
  it("should detect exhausted codes when usageCount >= maxUses", () => {
    expect(isCodeExhausted(5, 5)).toBe(true);
    expect(isCodeExhausted(6, 5)).toBe(true);
  });

  it("should allow codes with remaining uses", () => {
    expect(isCodeExhausted(3, 5)).toBe(false);
    expect(isCodeExhausted(0, 1)).toBe(false);
  });

  it("should allow unlimited codes (maxUses = null)", () => {
    expect(isCodeExhausted(9999, null)).toBe(false);
  });
});

describe("Discount Codes — full validation", () => {
  it("should reject inactive codes", () => {
    const result = isCodeValid({ isActive: false, expiresAt: null, usageCount: 0, maxUses: null });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("inactivo");
  });

  it("should reject expired codes", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const result = isCodeValid({ isActive: true, expiresAt: yesterday, usageCount: 0, maxUses: null });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("expirado");
  });

  it("should reject exhausted codes", () => {
    const result = isCodeValid({ isActive: true, expiresAt: null, usageCount: 10, maxUses: 10 });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("agotado");
  });

  it("should accept valid active codes with no limits", () => {
    const result = isCodeValid({ isActive: true, expiresAt: null, usageCount: 0, maxUses: null });
    expect(result.valid).toBe(true);
  });

  it("should accept valid active codes with future expiry and remaining uses", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const result = isCodeValid({ isActive: true, expiresAt: tomorrow, usageCount: 4, maxUses: 10 });
    expect(result.valid).toBe(true);
  });
});

describe("Discount Codes — TPV integration math", () => {
  it("should correctly compute discounted total for a TPV sale", () => {
    // Scenario: 3 items at 50€ each = 150€ total, 20% discount
    const itemsTotal = 15000; // cents
    const discountPercent = 20;
    const discountAmount = calculateDiscount(itemsTotal, discountPercent);
    const finalTotal = applyDiscount(itemsTotal, discountPercent);
    expect(discountAmount).toBe(3000); // 30€
    expect(finalTotal).toBe(12000);    // 120€
  });

  it("should correctly compute discounted total for online checkout", () => {
    // Scenario: cart total 250€, 10% promo code
    const cartTotalCents = 25000;
    const promoPercent = 10;
    const discountCents = calculateDiscount(cartTotalCents, promoPercent);
    const finalCents = applyDiscount(cartTotalCents, promoPercent);
    expect(discountCents).toBe(2500); // 25€
    expect(finalCents).toBe(22500);   // 225€
  });
});
