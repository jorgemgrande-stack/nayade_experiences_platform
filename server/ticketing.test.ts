/**
 * Ticketing module tests — v22.0
 * Tests for coupon redemption validation logic and duplicate detection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Helpers under test ───────────────────────────────────────────────────────

/** Normalise a coupon code the same way the router does */
function normaliseCouponCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** Detect if a new code is a duplicate of an existing list */
function isDuplicate(newCode: string, existing: string[]): boolean {
  const normalised = normaliseCouponCode(newCode);
  return existing.map(normaliseCouponCode).includes(normalised);
}

/** Validate that a coupon code has an acceptable format */
function isValidCouponCode(code: string): boolean {
  const normalised = normaliseCouponCode(code);
  // Must be between 4 and 64 characters, alphanumeric + hyphens/underscores
  return /^[A-Z0-9_\-]{4,64}$/.test(normalised);
}

/** Build a settlement summary for a set of redemptions */
function buildSettlementSummary(redemptions: Array<{ realAmount: string | null; statusFinancial: string }>) {
  const pending = redemptions.filter(r => r.statusFinancial === "pendiente_canje_proveedor");
  const settled = redemptions.filter(r => r.statusFinancial === "canjeado_en_proveedor");
  const totalPending = pending.reduce((acc, r) => acc + parseFloat(r.realAmount ?? "0"), 0);
  const totalSettled = settled.reduce((acc, r) => acc + parseFloat(r.realAmount ?? "0"), 0);
  return { pendingCount: pending.length, settledCount: settled.length, totalPending, totalSettled };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("normaliseCouponCode", () => {
  it("trims whitespace", () => {
    expect(normaliseCouponCode("  ABC123  ")).toBe("ABC123");
  });

  it("converts to uppercase", () => {
    expect(normaliseCouponCode("abc123")).toBe("ABC123");
  });

  it("removes internal spaces", () => {
    expect(normaliseCouponCode("ABC 123 XYZ")).toBe("ABC123XYZ");
  });

  it("preserves hyphens and underscores", () => {
    expect(normaliseCouponCode("ABC-123_XYZ")).toBe("ABC-123_XYZ");
  });
});

describe("isDuplicate", () => {
  const existing = ["GROUPON-001", "GROUPON-002", "LETSBONUS-100"];

  it("detects exact match", () => {
    expect(isDuplicate("GROUPON-001", existing)).toBe(true);
  });

  it("detects case-insensitive match", () => {
    expect(isDuplicate("groupon-001", existing)).toBe(true);
  });

  it("detects match with surrounding whitespace", () => {
    expect(isDuplicate("  GROUPON-002  ", existing)).toBe(true);
  });

  it("returns false for new unique code", () => {
    expect(isDuplicate("GROUPON-999", existing)).toBe(false);
  });

  it("returns false for empty existing list", () => {
    expect(isDuplicate("GROUPON-001", [])).toBe(false);
  });
});

describe("isValidCouponCode", () => {
  it("accepts valid Groupon-style codes", () => {
    expect(isValidCouponCode("GROUPON-2026-ABC123")).toBe(true);
  });

  it("accepts codes with underscores", () => {
    expect(isValidCouponCode("LETSBONUS_100_XYZ")).toBe(true);
  });

  it("rejects codes shorter than 4 chars", () => {
    expect(isValidCouponCode("AB")).toBe(false);
  });

  it("rejects codes with special characters", () => {
    expect(isValidCouponCode("ABC@123!")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidCouponCode("")).toBe(false);
  });

  it("accepts lowercase (normalised to upper)", () => {
    expect(isValidCouponCode("groupon-2026-abc")).toBe(true);
  });
});

describe("buildSettlementSummary", () => {
  const redemptions = [
    { realAmount: "35.00", statusFinancial: "pendiente_canje_proveedor" },
    { realAmount: "28.50", statusFinancial: "pendiente_canje_proveedor" },
    { realAmount: "42.00", statusFinancial: "canjeado_en_proveedor" },
    { realAmount: null,    statusFinancial: "pendiente_canje_proveedor" },
    { realAmount: "19.99", statusFinancial: "cobrado" },
  ];

  it("counts pending correctly", () => {
    const summary = buildSettlementSummary(redemptions);
    expect(summary.pendingCount).toBe(3);
  });

  it("counts settled correctly", () => {
    const summary = buildSettlementSummary(redemptions);
    expect(summary.settledCount).toBe(1);
  });

  it("sums pending amounts (null treated as 0)", () => {
    const summary = buildSettlementSummary(redemptions);
    expect(summary.totalPending).toBeCloseTo(63.5, 2);
  });

  it("sums settled amounts", () => {
    const summary = buildSettlementSummary(redemptions);
    expect(summary.totalSettled).toBeCloseTo(42.0, 2);
  });

  it("returns zeros for empty list", () => {
    const summary = buildSettlementSummary([]);
    expect(summary.pendingCount).toBe(0);
    expect(summary.totalPending).toBe(0);
  });
});
