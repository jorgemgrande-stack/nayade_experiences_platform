/**
 * send-test-emails.mjs
 * Envía todas las plantillas de email rediseñadas a reservas@nayadeexperiences.es
 * para revisión del cliente.
 *
 * Uso: node send-test-emails.mjs
 */

import nodemailer from "nodemailer";
import { readFileSync } from "fs";
import { createRequire } from "module";

// ─── Cargar variables de entorno ──────────────────────────────────────────────
const envPath = "/home/ubuntu/nayade_experiences_platform/.env";
let envVars = {};
try {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  console.log("No .env file found, using process.env");
}

const SMTP_HOST   = envVars.SMTP_HOST   || process.env.SMTP_HOST;
const SMTP_PORT   = parseInt(envVars.SMTP_PORT   || process.env.SMTP_PORT   || "587", 10);
const SMTP_USER   = envVars.SMTP_USER   || process.env.SMTP_USER;
const SMTP_PASS   = envVars.SMTP_PASS   || process.env.SMTP_PASS;
const SMTP_SECURE = (envVars.SMTP_SECURE || process.env.SMTP_SECURE) === "true";
const SMTP_FROM   = envVars.SMTP_FROM   || process.env.SMTP_FROM   || "Náyade Experiences <reservas@nayadeexperiences.es>";
const ADMIN_EMAIL = envVars.ADMIN_EMAIL || process.env.ADMIN_EMAIL || "reservas@nayadeexperiences.es";

if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error("❌ SMTP no configurado. Necesitas SMTP_HOST, SMTP_USER y SMTP_PASS.");
  process.exit(1);
}

// ─── Transporter ─────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  tls: { rejectUnauthorized: false },
});

// ─── Importar plantillas compiladas en tiempo de ejecución ───────────────────
// Como el proyecto usa TypeScript, necesitamos importar el JS compilado.
// Usamos tsx para ejecutar directamente el TS.
// Este script se ejecuta con: node --loader tsx send-test-emails.mjs

const {
  buildReservationConfirmHtml,
  buildReservationFailedHtml,
  buildRestaurantConfirmHtml,
  buildRestaurantPaymentLinkHtml,
  buildInviteHtml,
  buildPasswordResetHtml,
  buildBudgetRequestUserHtml,
  buildBudgetRequestAdminHtml,
} = await import("./server/emailTemplates.ts");

// ─── Datos de prueba ──────────────────────────────────────────────────────────
const NOW = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });

const emails = [
  {
    subject: "🏄 [PRUEBA] Reserva Confirmada — Kayak Doble",
    html: buildReservationConfirmHtml({
      merchantOrder: "NAY-2026-001234",
      productName: "Kayak Doble — 2 horas",
      customerName: "Carlos García",
      date: "sábado, 15 de junio de 2026",
      people: 2,
      amount: "45,00 €",
      extras: "Chaleco salvavidas premium x2",
    }),
  },
  {
    subject: "❌ [PRUEBA] Pago No Completado — Wakeboard Iniciación",
    html: buildReservationFailedHtml({
      merchantOrder: "NAY-2026-001235",
      productName: "Wakeboard Iniciación",
      customerName: "Laura Martínez",
      responseCode: "0190",
    }),
  },
  {
    subject: "🍽️ [PRUEBA] Reserva en La Cabaña del Lago — Confirmada",
    html: buildRestaurantConfirmHtml({
      guestName: "Miguel Fernández",
      restaurantName: "La Cabaña del Lago",
      date: "domingo, 22 de junio de 2026",
      time: "14:00",
      guests: 4,
      locator: "CAB-8847",
      depositAmount: "20",
      requiresPayment: false,
    }),
  },
  {
    subject: "💳 [PRUEBA] Confirma tu reserva en Nassau Bar — Depósito pendiente",
    html: buildRestaurantPaymentLinkHtml({
      guestName: "Ana López",
      guestEmail: "ana@ejemplo.com",
      restaurantName: "Nassau Bar",
      date: "viernes, 20 de junio de 2026",
      time: "21:00",
      guests: 6,
      locator: "NAS-3321",
      depositAmount: "30",
      redsysUrl: "https://sis-t.redsys.es:25443/sis/realizarPago",
      merchantParams: "eyJEU19NRVJDSEFOVF9BTU9VTlQiOiIzMDAwIiwiRFNfTUVSQ0hBTlRfT1JERVIiOiJURVNULTAwMSJ9",
      signatureVersion: "HMAC_SHA256_V1",
      signature: "test_signature_placeholder",
    }),
  },
  {
    subject: "👋 [PRUEBA] Bienvenido al equipo — Activa tu cuenta",
    html: buildInviteHtml({
      name: "Pedro Sánchez",
      role: "monitor",
      setPasswordUrl: "https://nayadeexperiences.es/activar?token=abc123xyz",
    }),
  },
  {
    subject: "🔐 [PRUEBA] Recuperar contraseña — Náyade Experiences",
    html: buildPasswordResetHtml({
      name: "María González",
      resetUrl: "https://nayadeexperiences.es/reset?token=def456uvw",
      expiryMinutes: 30,
    }),
  },
  {
    subject: "📋 [PRUEBA] Solicitud de presupuesto recibida — Familia Rodríguez",
    html: buildBudgetRequestUserHtml({
      name: "Roberto Rodríguez",
      email: "roberto@ejemplo.com",
      phone: "+34 612 345 678",
      arrivalDate: "15 de julio de 2026",
      adults: 2,
      children: 3,
      selectedCategory: "Acuático",
      selectedProduct: "Pack Día Completo Familiar",
      comments: "Tenemos un niño de 5 años. ¿Hay actividades para su edad?",
      submittedAt: NOW,
    }),
  },
  {
    subject: "⚡ [PRUEBA ADMIN] Nueva solicitud de presupuesto — Roberto Rodríguez",
    html: buildBudgetRequestAdminHtml({
      name: "Roberto Rodríguez",
      email: "roberto@ejemplo.com",
      phone: "+34 612 345 678",
      arrivalDate: "15 de julio de 2026",
      adults: 2,
      children: 3,
      selectedCategory: "Acuático",
      selectedProduct: "Pack Día Completo Familiar",
      comments: "Tenemos un niño de 5 años. ¿Hay actividades para su edad?",
      submittedAt: NOW,
    }),
  },
];

// ─── Enviar todos los emails ──────────────────────────────────────────────────
console.log(`\n📧 Enviando ${emails.length} plantillas de prueba a ${ADMIN_EMAIL}...\n`);

let ok = 0, fail = 0;
for (const email of emails) {
  try {
    await transporter.sendMail({
      from: SMTP_FROM,
      to: ADMIN_EMAIL,
      subject: email.subject,
      html: email.html,
    });
    console.log(`  ✅ Enviado: ${email.subject}`);
    ok++;
  } catch (err) {
    console.error(`  ❌ Error: ${email.subject}\n     ${err.message}`);
    fail++;
  }
}

console.log(`\n─────────────────────────────────────────`);
console.log(`✅ Enviados: ${ok}  ❌ Fallidos: ${fail}`);
console.log(`📬 Revisa la bandeja de ${ADMIN_EMAIL}`);
console.log(`─────────────────────────────────────────\n`);
