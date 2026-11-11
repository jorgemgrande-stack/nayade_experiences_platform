import { describe, it, expect } from "vitest";
import { publicBookingProblem, shiftDays, shiftRunsOn, timeInShift, weekdayOf } from "./restaurantBookingRules";

const shift = { id: 7, restaurantId: 1, startTime: "13:00", endTime: "16:00", maxCapacity: 10, daysOfWeek: [1, 2, 3, 4, 5], isActive: true };
const base = { restaurantId: 1, maxGroupSize: 8, shift, closures: [], date: "2030-06-04", time: "13:30", guests: 2, occupiedGuests: 0, today: "2030-06-01" };

describe("reglas de la reserva pública de restaurante", () => {
  it("día de la semana sin depender de la zona horaria; fechas imposibles", () => {
    expect(weekdayOf("2030-06-04")).toBe(2); // martes
    expect(weekdayOf("2030-02-30")).toBeNull();
    expect(weekdayOf("04/06/2030")).toBeNull();
    expect(shiftDays('[0,6]')).toEqual([0, 6]);
    expect(shiftDays(null)).toHaveLength(7);
    expect(shiftRunsOn(shift, "2030-06-02")).toBe(false); // domingo
  });

  it("hora dentro del turno, también si cruza la medianoche", () => {
    expect(timeInShift(shift, "13:00")).toBe(true);
    expect(timeInShift(shift, "15:59")).toBe(true);
    expect(timeInShift(shift, "16:00")).toBe(false);
    expect(timeInShift(shift, "12:30")).toBe(false);
    expect(timeInShift({ startTime: "21:00", endTime: "01:00" }, "00:30")).toBe(true);
    expect(timeInShift({ startTime: "21:00", endTime: "01:00" }, "02:00")).toBe(false);
    expect(timeInShift(shift, "25:00")).toBe(false);
  });

  it("acepta una reserva que cabe", () => {
    expect(publicBookingProblem(base)).toBeNull();
    expect(publicBookingProblem({ ...base, guests: 4, occupiedGuests: 6 })).toBeNull();
  });

  it("rechaza aforo superado, cierres y turnos no válidos", () => {
    expect(publicBookingProblem({ ...base, guests: 5, occupiedGuests: 6 })).toMatch(/Solo quedan 4 plazas/);
    expect(publicBookingProblem({ ...base, occupiedGuests: 10 })).toMatch(/completo/);
    expect(publicBookingProblem({ ...base, closures: [{ shiftId: null }] })).toMatch(/cerrado/);
    expect(publicBookingProblem({ ...base, closures: [{ shiftId: 7 }] })).toMatch(/cerrado/);
    expect(publicBookingProblem({ ...base, closures: [{ shiftId: 99 }] })).toBeNull();
    expect(publicBookingProblem({ ...base, shift: { ...shift, restaurantId: 2 } })).toMatch(/turno/);
    expect(publicBookingProblem({ ...base, shift: { ...shift, isActive: false } })).toMatch(/turno/);
    expect(publicBookingProblem({ ...base, shift: null })).toMatch(/turno/);
    expect(publicBookingProblem({ ...base, date: "2030-06-02" })).toMatch(/no se ofrece/);
    expect(publicBookingProblem({ ...base, time: "17:00" })).toMatch(/hora/);
    expect(publicBookingProblem({ ...base, date: "2030-05-28" })).toMatch(/pasada/);
    expect(publicBookingProblem({ ...base, guests: 9 })).toMatch(/máximo/);
  });
});
