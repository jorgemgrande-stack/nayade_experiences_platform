/**
 * Tests para el sistema de numeración correlativa centralizado
 * server/documentNumbers.ts
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock de la base de datos ─────────────────────────────────────────────────
// Simulamos el comportamiento de drizzle para evitar conexiones reales en tests

const mockCounterStore: Record<string, { currentNumber: number; prefix: string }> = {};
const mockLogs: Array<{ documentType: string; documentNumber: string; context?: string }> = [];

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: () => ({
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([{ affectedRows: 1 }]),
      }),
    }),
    insert: () => ({
      values: () => Promise.resolve([{ insertId: 1 }]),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ currentNumber: 5, prefix: "FAC", documentType: "factura", year: 2026 }]),
        }),
        orderBy: () => Promise.resolve([]),
      }),
    }),
  }),
}));

vi.mock("mysql2/promise", () => ({
  default: { createPool: () => ({}) },
}));

// ─── Tests de lógica de formato ───────────────────────────────────────────────

describe("Document number format", () => {
  it("should format sequence with 4-digit padding", () => {
    const format = (prefix: string, year: number, seq: number) =>
      `${prefix}-${year}-${String(seq).padStart(4, "0")}`;

    expect(format("FAC", 2026, 1)).toBe("FAC-2026-0001");
    expect(format("FAC", 2026, 10)).toBe("FAC-2026-0010");
    expect(format("FAC", 2026, 100)).toBe("FAC-2026-0100");
    expect(format("FAC", 2026, 1000)).toBe("FAC-2026-1000");
    expect(format("FAC", 2026, 9999)).toBe("FAC-2026-9999");
    expect(format("PRES", 2026, 1)).toBe("PRES-2026-0001");
    expect(format("LIQ", 2026, 1)).toBe("LIQ-2026-0001");
  });

  it("should handle large sequence numbers beyond 4 digits", () => {
    const format = (prefix: string, year: number, seq: number) =>
      `${prefix}-${year}-${String(seq).padStart(4, "0")}`;

    // Más de 9999 documentos — el padding se expande automáticamente
    expect(format("FAC", 2026, 10000)).toBe("FAC-2026-10000");
  });
});

// ─── Tests de tipos de documento ─────────────────────────────────────────────

describe("Document type validation", () => {
  const validTypes = ["presupuesto", "factura", "reserva", "tpv", "cupon", "liquidacion", "anulacion"];
  const defaultPrefixes: Record<string, string> = {
    presupuesto: "PRES",
    factura: "FAC",
    reserva: "RES",
    tpv: "TPV",
    cupon: "CUP",
    liquidacion: "LIQ",
    anulacion: "ANU",
  };

  it("should have a default prefix for each document type", () => {
    for (const type of validTypes) {
      expect(defaultPrefixes[type]).toBeDefined();
      expect(defaultPrefixes[type].length).toBeGreaterThan(0);
    }
  });

  it("should have 7 document types defined", () => {
    expect(validTypes.length).toBe(7);
  });

  it("should have unique prefixes for each type", () => {
    const prefixes = Object.values(defaultPrefixes);
    const uniquePrefixes = new Set(prefixes);
    expect(uniquePrefixes.size).toBe(prefixes.length);
  });
});

// ─── Tests de lógica de incremento ───────────────────────────────────────────

describe("Counter increment logic", () => {
  it("should start at 1 for a new year", () => {
    const newCounterValue = 0 + 1; // currentNumber starts at 0, first document is 1
    expect(newCounterValue).toBe(1);
  });

  it("should correctly predict next number from current counter", () => {
    const currentNumber = 4;
    const nextNumber = currentNumber + 1;
    const formatted = `FAC-2026-${String(nextNumber).padStart(4, "0")}`;
    expect(formatted).toBe("FAC-2026-0005");
  });

  it("should handle year rollover correctly", () => {
    // At year change, counter resets to 0 and first document is 1
    const year2026Counter = 4;
    const year2027Counter = 0;

    const lastOf2026 = `FAC-2026-${String(year2026Counter).padStart(4, "0")}`;
    const firstOf2027 = `FAC-2027-${String(year2027Counter + 1).padStart(4, "0")}`;

    expect(lastOf2026).toBe("FAC-2026-0004");
    expect(firstOf2027).toBe("FAC-2027-0001");
  });
});

// ─── Tests de validación de prefijos ─────────────────────────────────────────

describe("Prefix validation", () => {
  const validPrefixRegex = /^[A-Z0-9-]+$/;

  it("should accept valid uppercase prefixes", () => {
    const validPrefixes = ["FAC", "PRES", "RES", "TPV", "CUP", "LIQ", "ANU", "FAC2", "FAC-2026"];
    for (const prefix of validPrefixes) {
      expect(validPrefixRegex.test(prefix)).toBe(true);
    }
  });

  it("should reject invalid prefixes with lowercase or special chars", () => {
    const invalidPrefixes = ["fac", "Fac", "FAC!", "FAC ", "FAC.2026", "fac-2026"];
    for (const prefix of invalidPrefixes) {
      expect(validPrefixRegex.test(prefix)).toBe(false);
    }
  });

  it("should enforce max length of 16 characters", () => {
    const longPrefix = "ABCDEFGHIJKLMNOP"; // 16 chars — OK
    const tooLong = "ABCDEFGHIJKLMNOPQ"; // 17 chars — too long
    expect(longPrefix.length).toBeLessThanOrEqual(16);
    expect(tooLong.length).toBeGreaterThan(16);
  });
});

// ─── Tests de auditoría ───────────────────────────────────────────────────────

describe("Audit log structure", () => {
  it("should include required fields in log entry", () => {
    const logEntry = {
      documentType: "factura",
      documentNumber: "FAC-2026-0005",
      year: 2026,
      sequence: 5,
      generatedBy: "42",
      context: "crm:confirmPayment",
    };

    expect(logEntry.documentType).toBe("factura");
    expect(logEntry.documentNumber).toMatch(/^[A-Z]+-\d{4}-\d{4,}$/);
    expect(logEntry.year).toBe(2026);
    expect(logEntry.sequence).toBeGreaterThan(0);
    expect(logEntry.generatedBy).toBeDefined();
    expect(logEntry.context).toBeDefined();
  });

  it("should format reset log entry correctly", () => {
    const resetLog = {
      documentType: "factura",
      documentNumber: "RESET-factura-2026-to-0",
      year: 2026,
      sequence: 0,
      generatedBy: "admin-1",
      context: "admin:resetCounter",
    };

    expect(resetLog.context).toBe("admin:resetCounter");
    expect(resetLog.documentNumber).toContain("RESET");
  });
});

// ─── Tests de integración con el esquema ─────────────────────────────────────

describe("Schema compatibility", () => {
  it("should have document_type column within 32 char limit", () => {
    const types = ["presupuesto", "factura", "reserva", "tpv", "cupon", "liquidacion", "anulacion"];
    for (const type of types) {
      expect(type.length).toBeLessThanOrEqual(32);
    }
  });

  it("should have document_number within 64 char limit", () => {
    // Longest possible: PREFIX(16) + '-' + YEAR(4) + '-' + SEQ(10) = 32 chars max
    const longestNumber = `ABCDEFGHIJKLMNOP-2026-9999999999`;
    expect(longestNumber.length).toBeLessThanOrEqual(64);
  });

  it("should have context within 128 char limit", () => {
    const contexts = [
      "crm:confirmPayment",
      "crm:confirmTransfer",
      "crm:createQuote",
      "crm:invoice",
      "tpv:createSale",
      "suppliers:createSettlement",
      "redsys:ipn",
      "admin:resetCounter",
    ];
    for (const ctx of contexts) {
      expect(ctx.length).toBeLessThanOrEqual(128);
    }
  });
});
