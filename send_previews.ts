/**
 * Script de envío de todas las plantillas de email de usuario
 * a reservas@nayadeexperiences.es para verificación visual.
 *
 * Ejecutar con: pnpm tsx send_previews.ts
 */
import nodemailer from "nodemailer";
import {
  buildBudgetRequestUserHtml,
  buildReservationConfirmHtml,
  buildReservationFailedHtml,
  buildRestaurantConfirmHtml,
  buildRestaurantPaymentLinkHtml,
  buildPasswordResetHtml,
  buildQuoteHtml,
  buildConfirmationHtml,
  buildTransferConfirmationHtml,
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
    subject: "[PRUEBA 1/9] 🏄 Solicitud de presupuesto recibida — Náyade Experiences",
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
    subject: "[PRUEBA 2/9] ✅ Reserva confirmada — Ruta en Kayak — Náyade Experiences",
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
    subject: "[PRUEBA 3/9] ❌ Pago no completado — Ruta en Kayak — Náyade Experiences",
    build: () => buildReservationFailedHtml({
      merchantOrder: "NE-20260405-0001",
      productName: "Ruta en Kayak por el Embalse de Pontón Alto",
      customerName: "Carlos Pedraza",
      responseCode: "0190",
    }),
  },

  // 4. Reserva de restaurante confirmada
  {
    subject: "[PRUEBA 4/9] 🍽️ Reserva en El Galeón confirmada — Náyade Experiences",
    build: () => buildRestaurantConfirmHtml({
      guestName: "Carlos Pedraza",
      restaurantName: "El Galeón",
      date: "sábado, 5 de abril de 2026",
      time: "14:00",
      guests: 4,
      locator: "NR-TEST01",
      status: "confirmed",
    }),
  },

  // 5. Link de pago depósito restaurante
  {
    subject: "[PRUEBA 5/9] 💳 Completa tu reserva en Nassau Bar & Music — Náyade Experiences",
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
    subject: "[PRUEBA 6/9] 🔑 Recuperar contraseña — Náyade Experiences",
    build: () => buildPasswordResetHtml({
      name: "Carlos Pedraza",
      resetUrl: `${PORTAL}/reset-password?token=demo-token-abc123`,
      expiryMinutes: 120,
    }),
  },

  // 7. Presupuesto enviado al cliente
  {
    subject: "[PRUEBA 7/9] 📋 Tu presupuesto personalizado — Náyade Experiences",
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
    subject: "[PRUEBA 8/9] ✅ Tu reserva está confirmada — Náyade Experiences",
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
    subject: "[PRUEBA 9/9] 🏦 Transferencia recibida — Reserva confirmada — Náyade Experiences",
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
  console.log(`✅ Todos los emails enviados correctamente a ${TO}`);
}
