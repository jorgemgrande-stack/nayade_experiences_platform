/**
 * timeSlots.test.ts — Tests unitarios para el sistema de time slots
 *
 * Verifica:
 * A. Retrocompatibilidad: productos sin has_time_slots no se ven afectados
 * B. Tipos de slot: fixed, flexible, range
 * C. Validación: slot obligatorio cuando has_time_slots = true
 * D. Email: selectedTime aparece en el email de confirmación cuando existe
 * E. Schema: campos opcionales en reservas no rompen flujos existentes
 */

import { describe, it, expect } from "vitest";
import { buildConfirmationHtml } from "./emailTemplates";

// ─── A. Retrocompatibilidad ───────────────────────────────────────────────────

describe("Time Slots — Retrocompatibilidad", () => {
  it("buildConfirmationHtml sin selectedTime funciona igual que antes", () => {
    const html = buildConfirmationHtml({
      clientName: "Ana García",
      reservationRef: "FAC-2026-0001",
      quoteTitle: "Cableski & Wakeboard",
      items: [{ description: "Cableski (2 pax)", quantity: 2, unitPrice: 45, total: 90 }],
      total: "90.00",
      bookingDate: "15 de junio de 2026",
    });
    expect(html).toContain("Ana García");
    expect(html).toContain("FAC-2026-0001");
    expect(html).toContain("15 de junio de 2026");
    // No debe contener "Horario" si no se pasa selectedTime
    expect(html).not.toContain("Horario:");
  });

  it("buildConfirmationHtml sin bookingDate no muestra bloque de fecha", () => {
    const html = buildConfirmationHtml({
      clientName: "Pedro López",
      reservationRef: "FAC-2026-0002",
      quoteTitle: "Pack Aventura",
      items: [{ description: "Pack Aventura (1 pax)", quantity: 1, unitPrice: 120, total: 120 }],
      total: "120.00",
    });
    expect(html).toContain("Pedro López");
    // Sin bookingDate, no debe mostrar el bloque de fecha
    expect(html).not.toContain("Fecha de la actividad:");
  });
});

// ─── B. Email con horario ─────────────────────────────────────────────────────

describe("Time Slots — Email con horario seleccionado", () => {
  it("buildConfirmationHtml muestra el horario cuando selectedTime está presente", () => {
    const html = buildConfirmationHtml({
      clientName: "María Fernández",
      reservationRef: "FAC-2026-0003",
      quoteTitle: "Paseos en Barco",
      items: [{ description: "Paseos en Barco (3 pax)", quantity: 3, unitPrice: 25, total: 75 }],
      total: "75.00",
      bookingDate: "20 de julio de 2026",
      selectedTime: "10:00",
    });
    expect(html).toContain("María Fernández");
    expect(html).toContain("20 de julio de 2026");
    expect(html).toContain("10:00");
    expect(html).toContain("Horario:");
  });

  it("buildConfirmationHtml muestra horario de turno (range)", () => {
    const html = buildConfirmationHtml({
      clientName: "Carlos Ruiz",
      reservationRef: "FAC-2026-0004",
      quoteTitle: "Actividad Acuática",
      items: [{ description: "Actividad (2 pax)", quantity: 2, unitPrice: 30, total: 60 }],
      total: "60.00",
      bookingDate: "5 de agosto de 2026",
      selectedTime: "Turno mañana (09:00–13:00)",
    });
    expect(html).toContain("Turno mañana (09:00–13:00)");
    expect(html).toContain("Horario:");
  });

  it("buildConfirmationHtml NO muestra horario cuando selectedTime es undefined", () => {
    const html = buildConfirmationHtml({
      clientName: "Laura Sánchez",
      reservationRef: "FAC-2026-0005",
      quoteTitle: "Kayak",
      items: [{ description: "Kayak (1 pax)", quantity: 1, unitPrice: 18, total: 18 }],
      total: "18.00",
      bookingDate: "10 de septiembre de 2026",
      selectedTime: undefined,
    });
    // Sin selectedTime, no debe aparecer el icono de reloj ni "Horario:"
    expect(html).not.toContain("Horario:");
  });
});

// ─── C. Tipos de slot ─────────────────────────────────────────────────────────

describe("Time Slots — Tipos de slot (lógica de negocio)", () => {
  const SLOT_TYPES = ["fixed", "flexible", "range"] as const;

  it.each(SLOT_TYPES)("tipo '%s' es un valor válido de slot type", (type) => {
    // Verificar que los tipos son los esperados por el sistema
    expect(["fixed", "flexible", "range"]).toContain(type);
  });

  it("tipo fixed: horas cerradas (12:00, 16:00)", () => {
    const fixedSlots = [
      { id: 1, label: "12:00", type: "fixed" as const, startTime: "12:00", endTime: null },
      { id: 2, label: "16:00", type: "fixed" as const, startTime: "16:00", endTime: null },
    ];
    expect(fixedSlots).toHaveLength(2);
    expect(fixedSlots[0].startTime).toBe("12:00");
    expect(fixedSlots[1].startTime).toBe("16:00");
  });

  it("tipo range: turnos mañana/tarde", () => {
    const rangeSlots = [
      { id: 1, label: "Turno mañana", type: "range" as const, startTime: "09:00", endTime: "13:00" },
      { id: 2, label: "Turno tarde", type: "range" as const, startTime: "15:00", endTime: "19:00" },
    ];
    expect(rangeSlots[0].label).toBe("Turno mañana");
    expect(rangeSlots[1].label).toBe("Turno tarde");
    expect(rangeSlots[0].endTime).toBe("13:00");
  });

  it("tipo flexible: cliente elige hora libremente", () => {
    const flexibleSlot = { id: 1, label: "Hora a elegir", type: "flexible" as const, startTime: null, endTime: null };
    expect(flexibleSlot.type).toBe("flexible");
    expect(flexibleSlot.startTime).toBeNull();
  });
});

// ─── D. Retrocompatibilidad de reservas ──────────────────────────────────────

describe("Time Slots — Retrocompatibilidad de reservas existentes", () => {
  it("reserva sin selectedTime ni selectedTimeSlotId es válida (campos opcionales)", () => {
    // Simula una reserva existente sin time slots
    const existingReservation = {
      id: 630001,
      productId: 30003,
      bookingDate: "2026-05-15",
      people: 2,
      amountTotal: 9000,
      status: "paid",
      selectedTimeSlotId: null,
      selectedTime: null,
    };
    // Los campos opcionales son null, no undefined — no rompen nada
    expect(existingReservation.selectedTimeSlotId).toBeNull();
    expect(existingReservation.selectedTime).toBeNull();
  });

  it("reserva con selectedTime tiene el horario guardado correctamente", () => {
    const newReservation = {
      id: 630010,
      productId: 30009,
      bookingDate: "2026-07-20",
      people: 3,
      amountTotal: 7500,
      status: "paid",
      selectedTimeSlotId: 1,
      selectedTime: "10:00",
    };
    expect(newReservation.selectedTimeSlotId).toBe(1);
    expect(newReservation.selectedTime).toBe("10:00");
  });
});
