/**
 * Script de envío de todas las plantillas de email de usuario
 * a reservas@nayadeexperiences.es para verificación visual.
 *
 * Ejecutar con: pnpm tsx send_previews.ts
 */
import nodemailer from "nodemailer";
import {
  buildBudgetRequestUserHtml,
  buildBudgetRequestAdminHtml,
  buildReservationConfirmHtml,
  buildReservationFailedHtml,
  buildRestaurantConfirmHtml,
  buildRestaurantPaymentLinkHtml,
  buildPasswordResetHtml,
  buildInviteHtml,
  buildQuoteHtml,
  buildConfirmationHtml,
  buildTransferConfirmationHtml,
  buildCancellationReceivedHtml,
  buildCancellationRejectedHtml,
  buildCancellationAcceptedRefundHtml,
  buildCancellationAcceptedVoucherHtml,
  buildCancellationDocumentationHtml,
  buildTpvTicketHtml,
  buildCouponRedemptionReceivedHtml,
  buildCouponPostponedHtml,
  buildCouponInternalAlertHtml,
  buildPendingPaymentHtml,
  buildPendingPaymentReminderHtml,
} from "./server/emailTemplates";

const TO = "reservas@nayadeexperiences.es";
const SMTP_HOST = process.env.SMTP_HOST!;
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "465", 10);
const SMTP_USER = process.env.SMTP_USER!;
const SMTP_PASS = process.env.SMTP_PASS!;
const FROM = process.env.SMTP_FROM ?? `"Náyade Experiences" <${SMTP_USER}>`;
const PORTAL = "https://nayade-shop-av298fs8.manus.space";

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error("❌ SMTP no configurado. Verifica SMTP_HOST, SMTP_USER, SMTP_PASS");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

await transporter.verify();
console.log(`✅ SMTP verificado: ${SMTP_HOST}:${SMTP_PORT}\n`);
console.log(`📬 Destino: ${TO}\n`);

// ─── Plantillas (construcción lazy para evitar errores en inicialización) ────

type TemplateDef = { subject: string; build: () => string };

const templates: TemplateDef[] = [

  // 1. Solicitud de presupuesto recibida (al cliente)
  {
    subject: "[PRUEBA 1/22] 🏄 Solicitud de presupuesto recibida — Náyade Experiences",
    build: () => buildBudgetRequestUserHtml({
      name: "Carlos Pedraza",
      email: TO,
      phone: "+34 600 123 456",
      arrivalDate: "sábado, 5 de abril de 2026",
      adults: 5,
      children: 0,
      selectedCategory: "Acuáticas",
      selectedProduct: "Pack Cable Ski Experience",
      comments: "Queremos celebrar un cumpleaños, ¿podéis preparar algo especial?",
      submittedAt: new Date().toLocaleString("es-ES"),
    }),
  },

  // 2. Reserva confirmada — pago Redsys OK
  {
    subject: "[PRUEBA 2/22] ✅ Reserva confirmada — Ruta en Kayak — Náyade Experiences",
    build: () => buildReservationConfirmHtml({
      merchantOrder: "NE-20260405-0001",
      productName: "Ruta en Kayak por el Embalse de Pontón Alto",
      customerName: "Carlos Pedraza",
      date: "sábado, 5 de abril de 2026 a las 10:00",
      people: 2,
      amount: "79,00 €",
      extras: "Seguro de actividades x2",
    }),
  },

  // 3. Pago no completado — Redsys KO
  {
    subject: "[PRUEBA 3/22] ❌ Pago no completado — Ruta en Kayak — Náyade Experiences",
    build: () => buildReservationFailedHtml({
      merchantOrder: "NE-20260405-0001",
      productName: "Ruta en Kayak por el Embalse de Pontón Alto",
      customerName: "Carlos Pedraza",
      responseCode: "0190",
    }),
  },

  // 4. Reserva de restaurante confirmada
  {
    subject: "[PRUEBA 4/22] 🍽️ Reserva en El Galeón confirmada — Náyade Experiences",
    build: () => buildRestaurantConfirmHtml({
      guestName: "Carlos Pedraza",
      restaurantName: "El Galeón",
      date: "sábado, 5 de abril de 2026",
      time: "14:00",
      guests: 4,
      locator: "NR-TEST01",
      depositAmount: "0,00",
      requiresPayment: false,
    }),
  },

  // 5. Link de pago depósito restaurante
  {
    subject: "[PRUEBA 5/22] 💳 Completa tu reserva en Nassau Bar & Music — Náyade Experiences",
    build: () => buildRestaurantPaymentLinkHtml({
      guestName: "Carlos Pedraza",
      guestEmail: TO,
      restaurantName: "Nassau Bar & Music",
      date: "sábado, 5 de abril de 2026",
      time: "21:00",
      guests: 4,
      locator: "NR-TEST02",
      depositAmount: "20,00",
      redsysUrl: "https://sis-t.redsys.es:25443/sis/realizarPago",
      merchantParams: "DEMO_PARAMS",
      signatureVersion: "HMAC_SHA256_V1",
      signature: "DEMO_SIGNATURE",
    }),
  },

  // 6. Recuperar contraseña
  {
    subject: "[PRUEBA 6/22] 🔑 Recuperar contraseña — Náyade Experiences",
    build: () => buildPasswordResetHtml({
      name: "Carlos Pedraza",
      resetUrl: `${PORTAL}/reset-password?token=demo-token-abc123`,
      expiryMinutes: 120,
    }),
  },

  // 7. Presupuesto enviado al cliente
  {
    subject: "[PRUEBA 7/22] 📋 Tu presupuesto personalizado — Náyade Experiences",
    build: () => buildQuoteHtml({
      quoteNumber: "NQ-20260323-0042",
      title: "Pack Cable Ski Experience",
      clientName: "Carlos Pedraza",
      items: [
        { description: "Cable Ski (5 personas x 25€)", quantity: 5, unitPrice: 25, total: 125 },
        { description: "Alquiler de neopreno x5", quantity: 5, unitPrice: 8, total: 40 },
        { description: "Seguro de actividades x5", quantity: 5, unitPrice: 5, total: 25 },
      ],
      subtotal: "190,00",
      discount: "10%",
      tax: "0,00",
      total: "171,00",
      validUntil: new Date("2026-03-30"),
      notes: "Precio especial para grupos de 5 o más personas. Incluye monitor.",
      conditions: "Cancelación gratuita hasta 48h antes de la actividad.",
      paymentLinkUrl: `${PORTAL}/pago-demo`,
    }),
  },

  // 8. Reserva confirmada (CRM — factura enviada)
  {
    subject: "[PRUEBA 8/22] ✅ Tu reserva está confirmada — Náyade Experiences",
    build: () => buildConfirmationHtml({
      clientName: "Carlos Pedraza",
      reservationRef: "NE-20260405-0042",
      quoteTitle: "Pack Cable Ski Experience",
      items: [
        { description: "Cable Ski (5 personas x 25€)", quantity: 5, unitPrice: 25, total: 125 },
        { description: "Alquiler de neopreno x5", quantity: 5, unitPrice: 8, total: 40 },
        { description: "Seguro de actividades x5", quantity: 5, unitPrice: 5, total: 25 },
      ],
      subtotal: "190,00",
      taxAmount: "0,00",
      total: "171,00",
      invoiceUrl: `${PORTAL}/facturas/demo.pdf`,
      bookingDate: "sábado, 5 de abril de 2026 a las 10:00",
      contactPhone: "+34 930 34 77 91",
      contactEmail: "reservas@nayadeexperiences.es",
    }),
  },

  // 9. Pago por transferencia validado
  {
    subject: "[PRUEBA 9/22] 🏦 Transferencia recibida — Reserva confirmada — Náyade Experiences",
    build: () => buildTransferConfirmationHtml({
      clientName: "Carlos Pedraza",
      invoiceNumber: "FAC-2026-0042",
      reservationRef: "NE-20260405-0042",
      quoteTitle: "Pack Cable Ski Experience",
      items: [
        { description: "Cable Ski (5 personas x 25€)", quantity: 5, unitPrice: 25, total: 125 },
        { description: "Alquiler de neopreno x5", quantity: 5, unitPrice: 8, total: 40 },
        { description: "Seguro de actividades x5", quantity: 5, unitPrice: 5, total: 25 },
      ],
      subtotal: "190,00",
      taxAmount: "0,00",
      total: "171,00",
      invoiceUrl: `${PORTAL}/facturas/demo.pdf`,
      confirmedBy: "Jorge Grande",
      confirmedAt: new Date(),
    }),
  },

  // 10. Invitación de usuario al equipo
  {
    subject: "[PRUEBA 10/22] 👋 Invitación al equipo de Náyade Experiences",
    build: () => buildInviteHtml({
      name: "Ana Martínez",
      role: "admin",
      setPasswordUrl: `${PORTAL}/set-password?token=demo-invite-token-xyz`,
    }),
  },

  // 11. Solicitud de presupuesto — alerta interna al admin
  {
    subject: "[PRUEBA 11/22] 🔔 [INTERNO] Nueva solicitud de presupuesto — Náyade Experiences",
    build: () => buildBudgetRequestAdminHtml({
      name: "Carlos Pedraza",
      email: TO,
      phone: "+34 600 123 456",
      arrivalDate: "sábado, 5 de abril de 2026",
      adults: 5,
      children: 0,
      selectedCategory: "Acuáticas",
      selectedProduct: "Pack Cable Ski Experience",
      comments: "Queremos celebrar un cumpleaños, ¿podéis preparar algo especial?",
      submittedAt: new Date().toLocaleString("es-ES"),
    }),
  },

  // 12. Anulación recibida — en revisión
  {
    subject: "[PRUEBA 12/22] 🔄 Solicitud de anulación recibida — Náyade Experiences",
    build: () => buildCancellationReceivedHtml({
      fullName: "Carlos Pedraza",
      requestId: 23,
      locator: "NE-20260405-0001",
      reason: "Enfermedad acreditada con parte médico",
    }),
  },

  // 13. Anulación rechazada
  {
    subject: "[PRUEBA 13/22] ❌ Solicitud de anulación no aceptada — Náyade Experiences",
    build: () => buildCancellationRejectedHtml({
      fullName: "Carlos Pedraza",
      requestId: 23,
      adminText: "La solicitud fue recibida fuera del plazo de cancelación establecido en nuestras condiciones generales.",
    }),
  },

  // 14. Anulación aceptada con devolución económica
  {
    subject: "[PRUEBA 14/22] 💶 Devolución aprobada — Náyade Experiences",
    build: () => buildCancellationAcceptedRefundHtml({
      fullName: "Carlos Pedraza",
      requestId: 23,
      amount: "79,00",
      isPartial: false,
    }),
  },

  // 15. Anulación aceptada con bono de compensación
  {
    subject: "[PRUEBA 15/22] 🎫 Bono de compensación emitido — Náyade Experiences",
    build: () => buildCancellationAcceptedVoucherHtml({
      fullName: "Carlos Pedraza",
      requestId: 23,
      voucherCode: "BON-2026-XK7F2A",
      activityName: "Ruta en Kayak por el Embalse de Pontón Alto",
      value: "79,00",
      expiresAt: "31 de diciembre de 2026",
      isPartial: false,
    }),
  },

  // 16. Documentación adicional requerida
  {
    subject: "[PRUEBA 16/22] 📎 Documentación requerida para tu anulación — Náyade Experiences",
    build: () => buildCancellationDocumentationHtml({
      fullName: "Carlos Pedraza",
      requestId: 23,
      adminText: "1. Parte médico o informe que acredite la enfermedad\n2. DNI del titular de la reserva",
    }),
  },

  // 17. Ticket de compra TPV presencial
  {
    subject: "[PRUEBA 17/22] 🧾 Tu ticket de compra — Náyade Experiences",
    build: () => buildTpvTicketHtml({
      ticketNumber: "T-2026-0847",
      customerName: "Carlos Pedraza",
      createdAt: new Date(),
      items: [
        { name: "Wakeboard 1h", quantity: 2, unitPrice: 35, total: 70 },
        { name: "Alquiler de neopreno", quantity: 2, unitPrice: 8, total: 16 },
      ],
      payments: [
        { method: "card", amount: 86 },
      ],
      subtotal: 72.73,
      taxAmount: 13.27,
      total: 86,
    }),
  },

  // 18. Solicitud de canje de cupón recibida (al cliente)
  {
    subject: "[PRUEBA 18/22] 🎟️ Solicitud de canje recibida — Náyade Experiences",
    build: () => buildCouponRedemptionReceivedHtml({
      customerName: "Carlos Pedraza",
      coupons: [
        { couponCode: "GV-2026-ABC123", provider: "Groupon" },
        { couponCode: "GV-2026-DEF456", provider: "Groupon" },
      ],
      submissionId: "TKT-2026-0091",
      requestedDate: "sábado, 5 de abril de 2026",
    }),
  },

  // 19. Cupón sin disponibilidad — fecha pospuesta
  {
    subject: "[PRUEBA 19/22] ⏳ Sin disponibilidad para la fecha solicitada — Náyade Experiences",
    build: () => buildCouponPostponedHtml({
      customerName: "Carlos Pedraza",
      couponCode: "GV-2026-ABC123",
      provider: "Groupon",
      productName: "Wakeboard 1 hora",
      requestedDate: "sábado, 5 de abril de 2026",
    }),
  },

  // 20. Alerta interna — nuevo envío de cupones
  {
    subject: "[PRUEBA 20/22] 🔔 [INTERNO] Nuevo envío de cupones — Náyade Experiences",
    build: () => buildCouponInternalAlertHtml({
      customerName: "Carlos Pedraza",
      email: TO,
      phone: "+34 600 123 456",
      coupons: [
        { couponCode: "GV-2026-ABC123", provider: "Groupon" },
        { couponCode: "GV-2026-DEF456", provider: "Groupon" },
      ],
      submissionId: "TKT-2026-0091",
      requestedDate: "sábado, 5 de abril de 2026",
    }),
  },

  // 21. Reserva confirmada — pago pendiente (inicial)
  {
    subject: "[PRUEBA 21/22] ⏰ Reserva confirmada — Pago pendiente — Náyade Experiences",
    build: () => buildPendingPaymentHtml({
      clientName: "Carlos Pedraza",
      productName: "Pack Cable Ski Experience",
      amountFormatted: "171,00 €",
      dueDate: "viernes, 10 de abril de 2026",
      ibanInfo: "IBAN: ES12 3456 7890 1234 5678 9012\nConcepto: NE-20260405-0042",
      origin: "crm",
    }),
  },

  // 22. Recordatorio urgente de pago (5 días antes)
  {
    subject: "[PRUEBA 22/22] ⚠️ Recordatorio urgente — Pago pendiente — Náyade Experiences",
    build: () => buildPendingPaymentReminderHtml({
      clientName: "Carlos Pedraza",
      productName: "Pack Cable Ski Experience",
      amountFormatted: "171,00 €",
      dueDate: "viernes, 10 de abril de 2026",
      ibanInfo: "IBAN: ES12 3456 7890 1234 5678 9012\nConcepto: NE-20260405-0042",
      origin: "crm",
    }),
  },
];

// ─── Envío ───────────────────────────────────────────────────────────────────

let sent = 0;
let failed = 0;

for (const [i, tpl] of templates.entries()) {
  const num = String(i + 1).padStart(2, "0");
  const label = tpl.subject.replace(/^\[PRUEBA \d+\/\d+\] /, "");
  try {
    const html = tpl.build();
    await transporter.sendMail({ from: FROM, to: TO, subject: tpl.subject, html });
    console.log(`  ✅ [${num}/${templates.length}] ${label}`);
    sent++;
    await new Promise(r => setTimeout(r, 1000));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ [${num}/${templates.length}] ${label}`);
    console.error(`     → ${msg}`);
    failed++;
  }
}

console.log(`\n📊 Resultado: ${sent}/${templates.length} enviados${failed > 0 ? `, ${failed} fallidos` : ""}`);
if (sent === templates.length) {
  console.log(`✅ Las ${templates.length} plantillas enviadas correctamente a ${TO}`);
}
