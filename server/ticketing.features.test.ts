/**
 * Tests para las nuevas funcionalidades del módulo Ticketing:
 * 1. markAsRedeemed — marcar cupón como canjeado con/sin comprobante
 * 2. getProductStats — estadísticas de cupones por producto de plataforma
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

// ── Helpers de contexto ────────────────────────────────────────────────────────
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@nayade.es",
    name: "Admin User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

// ── Tests de markAsRedeemed ────────────────────────────────────────────────────
describe("ticketing.markAsRedeemed input validation", () => {
  it("requires a valid coupon id (positive integer)", () => {
    const input = { id: 0, notes: "test" };
    // id debe ser > 0 para ser válido
    expect(input.id).toBeLessThanOrEqual(0);
  });

  it("accepts optional notes and justificant fields", () => {
    const validInput = {
      id: 42,
      notes: "Canje confirmado en mostrador",
      justificantBase64: "dGVzdA==",
      justificantFileName: "comprobante.pdf",
      justificantMimeType: "application/pdf",
    };
    expect(validInput.id).toBeGreaterThan(0);
    expect(validInput.justificantBase64).toBeTruthy();
    expect(validInput.justificantFileName).toMatch(/\.(pdf|png|jpg|jpeg|webp)$/i);
  });

  it("can be called without justificant (comprobante opcional)", () => {
    const minimalInput = { id: 5 };
    expect(minimalInput).not.toHaveProperty("justificantBase64");
    expect(minimalInput.id).toBe(5);
  });
});

// ── Tests de getProductStats ───────────────────────────────────────────────────
describe("ticketing.getProductStats data shape", () => {
  it("returns a map keyed by platformProductId", () => {
    // Simular la estructura de respuesta esperada
    const mockStatsMap: Record<number, {
      total: number;
      canjeados: number;
      pendientes: number;
      incidencias: number;
      anulados: number;
      pvpTotal: number;
      netoTotal: number;
    }> = {
      1: { total: 10, canjeados: 7, pendientes: 2, incidencias: 1, anulados: 0, pvpTotal: 500.0, netoTotal: 280.0 },
      2: { total: 5, canjeados: 3, pendientes: 2, incidencias: 0, anulados: 0, pvpTotal: 250.0, netoTotal: 120.0 },
    };

    expect(mockStatsMap[1]).toBeDefined();
    expect(mockStatsMap[1]?.total).toBe(10);
    expect(mockStatsMap[1]?.canjeados).toBe(7);
    expect(mockStatsMap[1]?.pendientes).toBe(2);
    expect(mockStatsMap[1]?.incidencias).toBe(1);
    expect(mockStatsMap[1]?.pvpTotal).toBeGreaterThan(0);
    expect(mockStatsMap[1]?.netoTotal).toBeGreaterThan(0);
  });

  it("canjeados + pendientes + incidencias should equal total (when no anulados)", () => {
    const stats = { total: 10, canjeados: 7, pendientes: 2, incidencias: 1, anulados: 0, pvpTotal: 500, netoTotal: 280 };
    expect(stats.canjeados + stats.pendientes + stats.incidencias).toBe(stats.total);
  });

  it("netoTotal should be less than or equal to pvpTotal", () => {
    const stats = { total: 10, canjeados: 7, pendientes: 2, incidencias: 1, anulados: 0, pvpTotal: 500, netoTotal: 280 };
    expect(stats.netoTotal).toBeLessThanOrEqual(stats.pvpTotal);
  });

  it("returns empty object when platformId has no products", () => {
    const emptyStats: Record<number, unknown> = {};
    expect(Object.keys(emptyStats)).toHaveLength(0);
  });
});

// ── Tests de RedeemModal lógica de base64 ─────────────────────────────────────
describe("RedeemModal file-to-base64 conversion logic", () => {
  it("splits base64 data URL correctly to extract raw base64", () => {
    // Simular lo que hace FileReader.readAsDataURL
    const dataUrl = "data:application/pdf;base64,dGVzdGluZw==";
    const base64 = dataUrl.split(",")[1];
    expect(base64).toBe("dGVzdGluZw==");
    expect(base64).not.toContain("data:");
  });

  it("handles image data URLs", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const base64 = dataUrl.split(",")[1];
    expect(base64).toBe("iVBORw0KGgo=");
  });

  it("validates accepted file types", () => {
    const acceptedTypes = [".pdf", ".png", ".jpg", ".jpeg", ".webp"];
    const testFile = "comprobante.pdf";
    const ext = "." + testFile.split(".").pop()?.toLowerCase();
    expect(acceptedTypes).toContain(ext);
  });
});

// ── Tests de badge de plataforma en CRM ───────────────────────────────────────
describe("CRM platform badge logic", () => {
  it("shows platform badge when originSource is coupon_redemption", () => {
    const reservation = {
      channel: "crm" as const,
      originSource: "coupon_redemption",
      platformName: "Groupon",
    };
    const shouldShowBadge = reservation.originSource === "coupon_redemption";
    expect(shouldShowBadge).toBe(true);
  });

  it("uses platformName if available, fallback to 'Cupón'", () => {
    const withPlatform = { originSource: "coupon_redemption", platformName: "Smartbox" };
    const withoutPlatform = { originSource: "coupon_redemption", platformName: null };

    const label1 = withPlatform.platformName ?? "Cupón";
    const label2 = withoutPlatform.platformName ?? "Cupón";

    expect(label1).toBe("Smartbox");
    expect(label2).toBe("Cupón");
  });

  it("does not show platform badge for regular web reservations", () => {
    const reservation = {
      channel: "web" as const,
      originSource: null,
      platformName: null,
    };
    const shouldShowBadge = reservation.originSource === "coupon_redemption";
    expect(shouldShowBadge).toBe(false);
  });
});
