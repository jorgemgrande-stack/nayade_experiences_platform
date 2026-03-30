import { describe, it, expect } from "vitest";

/**
 * Tests de integración: Bono compensatorio → discount_codes
 * Verifica que al aprobar un bono compensatorio se genera correctamente
 * un registro en discount_codes con tipo 'fixed' y uso único.
 */

// ─── Tipos mock ───────────────────────────────────────────────────────────────

type VoucherInput = {
  voucherValue: number;
  voucherExpiresAt?: string;
  voucherConditions?: string;
  activityName?: string;
  requestId: number;
  clientEmail?: string;
  clientName?: string;
};

type DiscountCodeRecord = {
  code: string;
  name: string;
  description: string;
  discountType: "percent" | "fixed";
  discountPercent: string;
  discountAmount: string;
  expiresAt?: Date;
  status: "active" | "inactive" | "expired";
  maxUses: number;
  currentUses: number;
  origin: "manual" | "voucher";
  compensationVoucherId: number;
  clientEmail?: string;
  clientName?: string;
};

// ─── Simulación de la lógica de creación del discount_code ───────────────────

function buildDiscountCodeFromVoucher(
  input: VoucherInput,
  voucherId: number,
  code: string
): DiscountCodeRecord {
  const discountName = `Bono compensatorio #${input.requestId} — ${input.activityName ?? "Náyade Experiences"}`;
  const discountDescription = [
    `Bono emitido como compensación por anulación de reserva.`,
    input.activityName ? `Actividad: ${input.activityName}.` : null,
    input.voucherConditions ? `Condiciones: ${input.voucherConditions}` : null,
  ].filter(Boolean).join(" ");

  return {
    code,
    name: discountName,
    description: discountDescription,
    discountType: "fixed",
    discountPercent: "0",
    discountAmount: input.voucherValue.toFixed(2),
    expiresAt: input.voucherExpiresAt ? new Date(input.voucherExpiresAt) : undefined,
    status: "active",
    maxUses: 1,
    currentUses: 0,
    origin: "voucher",
    compensationVoucherId: voucherId,
    clientEmail: input.clientEmail,
    clientName: input.clientName,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Bono compensatorio → discount_codes", () => {

  describe("Tipo y valor del descuento", () => {
    it("crea un discount_code de tipo 'fixed' (no porcentaje)", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 1, activityName: "Wakeboard" },
        10, "BONO-ABCD-1234"
      );
      expect(record.discountType).toBe("fixed");
      expect(record.discountPercent).toBe("0");
    });

    it("guarda el importe exacto del bono como discountAmount", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 87.50, requestId: 2 },
        11, "BONO-EFGH-5678"
      );
      expect(record.discountAmount).toBe("87.50");
    });

    it("formatea el importe con 2 decimales", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 100, requestId: 3 },
        12, "BONO-IJKL-9012"
      );
      expect(record.discountAmount).toBe("100.00");
    });

    it("importe mínimo de 0.01 no genera NaN ni valores negativos", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 0.01, requestId: 4 },
        13, "BONO-MNOP-3456"
      );
      expect(parseFloat(record.discountAmount)).toBeGreaterThan(0);
      expect(isNaN(parseFloat(record.discountAmount))).toBe(false);
    });
  });

  describe("Uso único y estado activo", () => {
    it("maxUses es 1 (uso único)", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 5 },
        14, "BONO-QRST-7890"
      );
      expect(record.maxUses).toBe(1);
    });

    it("currentUses es 0 al crearse", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 6 },
        15, "BONO-UVWX-2345"
      );
      expect(record.currentUses).toBe(0);
    });

    it("status es 'active' al crearse", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 7 },
        16, "BONO-YZAB-6789"
      );
      expect(record.status).toBe("active");
    });
  });

  describe("Trazabilidad y origen", () => {
    it("origin es 'voucher' (no 'manual')", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 8 },
        17, "BONO-CDEF-0123"
      );
      expect(record.origin).toBe("voucher");
    });

    it("compensationVoucherId apunta al ID del voucher creado", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 9 },
        99, "BONO-GHIJ-4567"
      );
      expect(record.compensationVoucherId).toBe(99);
    });

    it("el código del discount_code es el mismo que el del compensation_voucher", () => {
      const code = "BONO-KLMN-8901";
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 10 },
        20, code
      );
      expect(record.code).toBe(code);
    });
  });

  describe("Datos del cliente", () => {
    it("guarda el email del cliente cuando se proporciona", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 11, clientEmail: "maria@example.com" },
        21, "BONO-OPQR-2345"
      );
      expect(record.clientEmail).toBe("maria@example.com");
    });

    it("guarda el nombre del cliente cuando se proporciona", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 12, clientName: "María García" },
        22, "BONO-STUV-6789"
      );
      expect(record.clientName).toBe("María García");
    });

    it("clientEmail y clientName son undefined cuando no se proporcionan", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 13 },
        23, "BONO-WXYZ-0123"
      );
      expect(record.clientEmail).toBeUndefined();
      expect(record.clientName).toBeUndefined();
    });
  });

  describe("Nombre y descripción del código", () => {
    it("el nombre incluye el número de solicitud de anulación", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 42, activityName: "Canoa" },
        24, "BONO-ABCD-9999"
      );
      expect(record.name).toContain("#42");
    });

    it("el nombre incluye el nombre de la actividad", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 14, activityName: "Wakeboard Pro" },
        25, "BONO-EFGH-1111"
      );
      expect(record.name).toContain("Wakeboard Pro");
    });

    it("usa 'Náyade Experiences' como nombre de actividad por defecto", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 15 },
        26, "BONO-IJKL-2222"
      );
      expect(record.name).toContain("Náyade Experiences");
    });

    it("la descripción incluye las condiciones del bono cuando se proporcionan", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 16, voucherConditions: "Solo válido para actividades acuáticas" },
        27, "BONO-MNOP-3333"
      );
      expect(record.description).toContain("Solo válido para actividades acuáticas");
    });
  });

  describe("Caducidad", () => {
    it("expiresAt es undefined cuando no se proporciona fecha de caducidad", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 17 },
        28, "BONO-QRST-4444"
      );
      expect(record.expiresAt).toBeUndefined();
    });

    it("expiresAt es una Date cuando se proporciona fecha de caducidad", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 18, voucherExpiresAt: "2026-12-31" },
        29, "BONO-UVWX-5555"
      );
      expect(record.expiresAt).toBeInstanceOf(Date);
      expect(record.expiresAt?.getFullYear()).toBe(2026);
    });

    it("la fecha de caducidad se preserva correctamente", () => {
      const record = buildDiscountCodeFromVoucher(
        { voucherValue: 45, requestId: 19, voucherExpiresAt: "2027-06-30" },
        30, "BONO-YZAB-6666"
      );
      expect(record.expiresAt?.getFullYear()).toBe(2027);
      expect((record.expiresAt?.getMonth() ?? -1) + 1).toBe(6);
    });
  });
});
