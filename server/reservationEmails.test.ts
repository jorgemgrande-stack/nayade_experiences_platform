/**
 * Tests para el módulo de notificaciones de reservas.
 * Verifica que las funciones de email se comportan correctamente
 * con y sin configuración SMTP.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock de nodemailer
vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: "test-id" }),
      verify: vi.fn().mockResolvedValue(true),
    })),
  },
}));

// Mock de notifyOwner
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import { sendReservationPaidNotifications, sendReservationFailedNotifications } from "./reservationEmails";
import { notifyOwner } from "./_core/notification";
import nodemailer from "nodemailer";

const mockReservation = {
  id: 1,
  merchantOrder: "NY1A2B3C4D5E",
  productName: "Experiencia Acuática Premium",
  bookingDate: "2025-07-15",
  people: 2,
  amountTotal: 15000, // 150.00 €
  amountPaid: 15000,
  customerName: "María García",
  customerEmail: "maria@example.com",
  customerPhone: "+34 600 000 000",
  extrasJson: JSON.stringify([{ name: "Snorkel", price: 1000, quantity: 2 }]),
  status: "paid",
};

describe("sendReservationPaidNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("siempre envía notificación interna al owner", async () => {
    // Sin SMTP configurado
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    await sendReservationPaidNotifications(mockReservation);

    expect(notifyOwner).toHaveBeenCalledOnce();
    expect(notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining(mockReservation.productName),
        content: expect.stringContaining(mockReservation.merchantOrder),
      })
    );
  });

  it("envía email al cliente cuando SMTP está configurado", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASS = "password";
    process.env.SMTP_PORT = "587";

    await sendReservationPaidNotifications(mockReservation);

    const mockTransport = (nodemailer.createTransport as any).mock.results[0]?.value;
    expect(mockTransport?.sendMail).toHaveBeenCalledOnce();
    expect(mockTransport?.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: mockReservation.customerEmail,
        subject: expect.stringContaining(mockReservation.productName),
        html: expect.stringContaining(mockReservation.merchantOrder),
      })
    );
  });

  it("no falla si SMTP no está configurado", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    // No debe lanzar error
    await expect(sendReservationPaidNotifications(mockReservation)).resolves.not.toThrow();
  });
});

describe("sendReservationFailedNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("siempre envía notificación interna de fallo", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    await sendReservationFailedNotifications(mockReservation, "0190");

    expect(notifyOwner).toHaveBeenCalledOnce();
    expect(notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining(mockReservation.productName),
        content: expect.stringContaining("0190"),
      })
    );
  });

  it("envía email de fallo al cliente cuando SMTP está configurado", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASS = "password";
    process.env.SMTP_PORT = "587";

    await sendReservationFailedNotifications(mockReservation, "0190");

    const mockTransport = (nodemailer.createTransport as any).mock.results[0]?.value;
    expect(mockTransport?.sendMail).toHaveBeenCalledOnce();
    expect(mockTransport?.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: mockReservation.customerEmail,
        subject: expect.stringContaining("no completado"),
      })
    );
  });
});
