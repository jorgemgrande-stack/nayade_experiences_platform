/**
 * Consulta pública de una reserva de restaurante por localizador (páginas de resultado del pago, sin sesión):
 * solo la vista mínima; nunca teléfono, alergias, peticiones, notas internas ni el correo completo.
 */
import { describe, it, expect } from "vitest";
import { maskEmail, publicBookingView } from "./restaurantsDb";
import type { RestaurantBooking } from "../drizzle/schema";

const booking = {
  id: 7,
  locator: "NR-AB23CD",
  restaurantId: 1,
  shiftId: 2,
  date: "2026-11-02",
  time: "21:00",
  guests: 4,
  depositAmount: "20.00",
  guestName: "Laura",
  guestLastName: "Representante",
  guestEmail: "laura@ejemplo.com",
  guestPhone: "+34600000000",
  highchair: false,
  allergies: "frutos secos",
  birthday: false,
  specialRequests: "mesa junto a la ventana",
  accessibility: false,
  isVip: true,
  status: "confirmed",
  cancellationReason: null,
  adminNotes: "cliente habitual",
  channel: "web",
  createdByUserId: null,
  paymentStatus: "paid",
  paymentTransactionId: "tx_123",
} as unknown as RestaurantBooking;

describe("reserva de restaurante: vista pública por localizador", () => {
  it("solo expone lo que muestran las páginas de resultado, con el correo enmascarado", () => {
    const v = publicBookingView(booking);
    expect(v).toEqual({
      locator: "NR-AB23CD",
      date: "2026-11-02",
      time: "21:00",
      guests: 4,
      depositAmount: "20.00",
      status: "confirmed",
      paymentStatus: "paid",
      guestName: "Laura",
      guestLastName: "R.",
      guestEmail: "l***@e***.com",
    });
    const text = JSON.stringify(v);
    for (const secret of ["+34600000000", "frutos secos", "ventana", "habitual", "tx_123", "laura@ejemplo.com", "Representante"]) expect(text).not.toContain(secret);
  });

  it("enmascara correos atípicos sin fallar", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("sin-arroba")).toBe("s***@***");
    expect(maskEmail("a@localhost")).toBe("a***@l***");
  });
});
