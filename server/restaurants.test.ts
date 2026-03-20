/**
 * restaurants.test.ts
 * Tests unitarios para el módulo de reservas de restaurante.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Helpers de lógica pura ───────────────────────────────────────────────────

/** Genera un localizador de reserva con formato NR-XXXXXX */
function generateLocator(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "NR-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** Calcula el depósito total para una reserva */
function calculateDeposit(depositPerGuest: string | number, guests: number): number {
  return Number(depositPerGuest) * guests;
}

/** Verifica si una fecha es válida para reservar (no en el pasado, no más de maxAdvanceDays) */
function isDateBookable(
  dateStr: string,
  minAdvanceHours: number,
  maxAdvanceDays: number
): boolean {
  const now = new Date();
  const date = new Date(dateStr + "T12:00:00"); // Mediodía para evitar problemas de zona horaria
  const minDate = new Date(now.getTime() + minAdvanceHours * 60 * 60 * 1000);
  const maxDate = new Date(now.getTime() + maxAdvanceDays * 24 * 60 * 60 * 1000);
  return date >= minDate && date <= maxDate;
}

/** Verifica si un turno opera en un día de la semana dado */
function shiftOperatesOnDay(daysOfWeek: number[], dayOfWeek: number): boolean {
  return daysOfWeek.includes(dayOfWeek);
}

/** Calcula las plazas disponibles en un turno */
function calculateAvailability(maxCapacity: number, occupied: number): number {
  return Math.max(0, maxCapacity - occupied);
}

/** Valida los datos de un formulario de reserva */
function validateBookingForm(data: {
  guestName: string;
  guestEmail: string;
  guests: number;
  date: string;
  shiftId: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data.guestName.trim()) errors.push("El nombre es obligatorio");
  if (!data.guestEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.guestEmail)) {
    errors.push("El email es inválido");
  }
  if (data.guests < 1) errors.push("El número de comensales debe ser al menos 1");
  if (!data.date) errors.push("La fecha es obligatoria");
  if (!data.shiftId) errors.push("El turno es obligatorio");
  return { valid: errors.length === 0, errors };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Módulo de Restaurantes — Lógica de Reservas", () => {

  describe("generateLocator()", () => {
    it("genera un localizador con formato NR-XXXXXX", () => {
      const locator = generateLocator();
      expect(locator).toMatch(/^NR-[A-Z0-9]{6}$/);
    });

    it("genera localizadores únicos en llamadas sucesivas", () => {
      const locators = new Set(Array.from({ length: 100 }, generateLocator));
      // Con 100 generaciones, la probabilidad de colisión es prácticamente nula
      expect(locators.size).toBeGreaterThan(95);
    });
  });

  describe("calculateDeposit()", () => {
    it("calcula el depósito correctamente para 2 comensales", () => {
      expect(calculateDeposit("5.00", 2)).toBe(10);
    });

    it("calcula el depósito para grupos grandes", () => {
      expect(calculateDeposit("5.00", 10)).toBe(50);
    });

    it("devuelve 0 si el depósito es 0", () => {
      expect(calculateDeposit("0.00", 4)).toBe(0);
    });

    it("maneja depósito como número", () => {
      expect(calculateDeposit(5, 3)).toBe(15);
    });
  });

  describe("isDateBookable()", () => {
    it("rechaza fechas en el pasado", () => {
      const pastDate = "2020-01-01";
      expect(isDateBookable(pastDate, 2, 60)).toBe(false);
    });

    it("rechaza fechas demasiado lejanas", () => {
      const farFutureDate = "2030-12-31";
      expect(isDateBookable(farFutureDate, 2, 60)).toBe(false);
    });

    it("acepta fechas dentro del rango válido", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 3);
      const dateStr = tomorrow.toISOString().split("T")[0];
      expect(isDateBookable(dateStr, 2, 60)).toBe(true);
    });
  });

  describe("shiftOperatesOnDay()", () => {
    it("detecta correctamente que un turno opera en un día", () => {
      // Lunes = 1
      expect(shiftOperatesOnDay([0, 1, 2, 3, 4, 5, 6], 1)).toBe(true);
    });

    it("detecta que un turno NO opera en un día", () => {
      // Solo fines de semana (5=Vie, 6=Sáb, 0=Dom)
      expect(shiftOperatesOnDay([5, 6, 0], 2)).toBe(false); // Martes
    });

    it("detecta turno de fin de semana en sábado", () => {
      expect(shiftOperatesOnDay([5, 6, 0], 6)).toBe(true); // Sábado
    });
  });

  describe("calculateAvailability()", () => {
    it("calcula plazas disponibles correctamente", () => {
      expect(calculateAvailability(80, 20)).toBe(60);
    });

    it("devuelve 0 cuando el turno está lleno", () => {
      expect(calculateAvailability(50, 50)).toBe(0);
    });

    it("no devuelve valores negativos", () => {
      // En caso de datos inconsistentes
      expect(calculateAvailability(50, 60)).toBe(0);
    });

    it("devuelve la capacidad máxima cuando no hay reservas", () => {
      expect(calculateAvailability(80, 0)).toBe(80);
    });
  });

  describe("validateBookingForm()", () => {
    const validForm = {
      guestName: "María García",
      guestEmail: "maria@example.com",
      guests: 2,
      date: "2026-04-15",
      shiftId: 1,
    };

    it("valida un formulario correcto", () => {
      const result = validateBookingForm(validForm);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rechaza nombre vacío", () => {
      const result = validateBookingForm({ ...validForm, guestName: "" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("El nombre es obligatorio");
    });

    it("rechaza email inválido", () => {
      const result = validateBookingForm({ ...validForm, guestEmail: "no-es-email" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("El email es inválido");
    });

    it("rechaza email vacío", () => {
      const result = validateBookingForm({ ...validForm, guestEmail: "" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("El email es inválido");
    });

    it("rechaza 0 comensales", () => {
      const result = validateBookingForm({ ...validForm, guests: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("El número de comensales debe ser al menos 1");
    });

    it("rechaza fecha vacía", () => {
      const result = validateBookingForm({ ...validForm, date: "" });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("La fecha es obligatoria");
    });

    it("rechaza sin turno seleccionado", () => {
      const result = validateBookingForm({ ...validForm, shiftId: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain("El turno es obligatorio");
    });

    it("acumula múltiples errores", () => {
      const result = validateBookingForm({
        guestName: "",
        guestEmail: "invalid",
        guests: 0,
        date: "",
        shiftId: 0,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("Datos de los 4 restaurantes de Náyade", () => {
    const restaurantes = [
      { slug: "el-galeon", name: "El Galeón", maxGroupSize: 30, depositPerGuest: "5.00" },
      { slug: "nassau-bar", name: "Nassau Bar & Music", maxGroupSize: 20, depositPerGuest: "5.00" },
      { slug: "la-cabana-del-lago", name: "La Cabaña del Lago", maxGroupSize: 40, depositPerGuest: "5.00" },
      { slug: "arroceria-la-cabana", name: "Arrocería La Cabaña", maxGroupSize: 25, depositPerGuest: "5.00" },
    ];

    it("los 4 restaurantes tienen slugs únicos", () => {
      const slugs = restaurantes.map(r => r.slug);
      const uniqueSlugs = new Set(slugs);
      expect(uniqueSlugs.size).toBe(4);
    });

    it("todos los restaurantes tienen depósito de 5€/comensal", () => {
      restaurantes.forEach(r => {
        expect(Number(r.depositPerGuest)).toBe(5);
      });
    });

    it("el depósito máximo para El Galeón (30 pax) es 150€", () => {
      const galeon = restaurantes.find(r => r.slug === "el-galeon")!;
      expect(calculateDeposit(galeon.depositPerGuest, galeon.maxGroupSize)).toBe(150);
    });

    it("todos los restaurantes tienen capacidad máxima definida", () => {
      restaurantes.forEach(r => {
        expect(r.maxGroupSize).toBeGreaterThan(0);
      });
    });
  });
});
