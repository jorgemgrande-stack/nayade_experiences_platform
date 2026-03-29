/**
 * Script: Enviar todas las plantillas de email de prueba
 * Uso: node send_templates_test.mjs
 */
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const TO_EMAIL = 'reservas@nayadeexperiences.es';

// ── Nodemailer transporter ────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail(to, subject, html) {
  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'noreply@nayadeexperiences.es',
    to,
    subject,
    html,
  });
}

// ── Brand base template ────────────────────────────────────────────────────────
function base(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#1a5276;padding:28px 32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px;">Náyade Experiences</h1>
          <p style="margin:4px 0 0;color:#d4ac0d;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Aventura · Naturaleza · Bienestar</p>
        </td></tr>
        <tr><td style="padding:32px;">${bodyHtml}</td></tr>
        <tr><td style="background:#2c3e50;padding:20px 32px;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:11px;">© ${new Date().getFullYear()} Náyade Experiences · Todos los derechos reservados</p>
          <p style="margin:4px 0 0;color:#64748b;font-size:10px;">Este es un email de prueba del sistema de plantillas estandarizadas</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Template definitions ───────────────────────────────────────────────────────
const TEMPLATES = [
  {
    id: 'reservation_confirm',
    name: 'Confirmación de Reserva',
    category: 'RESERVAS',
    html: base('Confirmación de Reserva', `
      <h2 style="color:#1a5276;margin:0 0 16px;">¡Tu reserva está confirmada!</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>María García López</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Nos complace confirmar tu reserva. Aquí tienes todos los detalles:</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:10px;background:#f8f9fa;border-radius:6px 6px 0 0;"><strong style="color:#1a5276;">Actividad</strong></td><td style="padding:10px;background:#f8f9fa;">Wakeboard para principiantes</td></tr>
        <tr><td style="padding:10px;background:#fff;border-top:1px solid #e5e7eb;"><strong style="color:#1a5276;">Fecha</strong></td><td style="padding:10px;background:#fff;border-top:1px solid #e5e7eb;">15 de agosto de 2026</td></tr>
        <tr><td style="padding:10px;background:#f8f9fa;border-top:1px solid #e5e7eb;"><strong style="color:#1a5276;">Hora</strong></td><td style="padding:10px;background:#f8f9fa;border-top:1px solid #e5e7eb;">10:00</td></tr>
        <tr><td style="padding:10px;background:#fff;border-top:1px solid #e5e7eb;"><strong style="color:#1a5276;">Participantes</strong></td><td style="padding:10px;background:#fff;border-top:1px solid #e5e7eb;">2</td></tr>
        <tr><td style="padding:10px;background:#f8f9fa;border-top:1px solid #e5e7eb;border-radius:0 0 6px 6px;"><strong style="color:#1a5276;">Total</strong></td><td style="padding:10px;background:#f8f9fa;border-top:1px solid #e5e7eb;border-radius:0 0 6px 6px;"><strong style="color:#d4ac0d;">89,00 €</strong></td></tr>
      </table>
      <p style="color:#6b7280;font-size:12px;">Localizador: <strong>NAY-2026-0042</strong></p>
    `),
  },
  {
    id: 'reservation_failed',
    name: 'Reserva Fallida',
    category: 'RESERVAS',
    html: base('Reserva Fallida', `
      <h2 style="color:#dc2626;margin:0 0 16px;">No hemos podido procesar tu reserva</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Carlos Martínez</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Lamentablemente no hemos podido completar el pago de tu reserva para <strong>Kayak en el lago</strong> el <strong>20 de julio de 2026</strong>.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://nayadeexperiences.es" style="background:#1a5276;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Intentar de nuevo</a>
      </div>
    `),
  },
  {
    id: 'transfer_confirmation',
    name: 'Confirmación de Transferencia',
    category: 'RESERVAS',
    html: base('Confirmación de Transferencia', `
      <h2 style="color:#1a5276;margin:0 0 16px;">Transferencia registrada</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Pedro Sánchez</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Tu plaza quedará confirmada en cuanto recibamos la transferencia de <strong style="color:#d4ac0d;">210,00 €</strong> para <strong>Curso de vela ligera</strong> el <strong>5 de octubre de 2026</strong>.</p>
      <div style="background:#f0f9ff;border-left:4px solid #1a5276;padding:16px;border-radius:0 6px 6px 0;margin:0 0 20px;">
        <p style="margin:0 0 6px;font-weight:600;color:#1a5276;">Datos bancarios</p>
        <p style="margin:0;color:#374151;font-size:13px;">IBAN: ES12 3456 7890 1234 5678 9012<br/>Concepto: <strong>NAY-2026-0045</strong></p>
      </div>
    `),
  },
  {
    id: 'restaurant_confirm',
    name: 'Confirmación Reserva Restaurante',
    category: 'RESERVAS',
    html: base('Confirmación Reserva Restaurante', `
      <h2 style="color:#1a5276;margin:0 0 16px;">¡Reserva de restaurante confirmada!</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Elena Martínez</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Tu mesa en <strong>Restaurante El Lago</strong> está reservada para el <strong>25 de agosto de 2026 a las 14:00</strong> para <strong>4 personas</strong>.</p>
      <p style="color:#6b7280;font-size:12px;">Localizador: <strong>REST-2026-0012</strong></p>
    `),
  },
  {
    id: 'restaurant_payment_link',
    name: 'Enlace de Pago Restaurante',
    category: 'RESERVAS',
    html: base('Enlace de Pago — Restaurante', `
      <h2 style="color:#1a5276;margin:0 0 16px;">Confirma tu reserva de restaurante</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Elena Martínez</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Para confirmar tu mesa en <strong>Restaurante El Lago</strong> el <strong>25 de agosto de 2026</strong>, realiza el pago de <strong style="color:#d4ac0d;">120,00 €</strong> antes del <strong>23 de agosto</strong>.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://nayadeexperiences.es/pago/REST-2026-0012" style="background:#d4ac0d;color:#1a1a1a;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;font-size:16px;">Pagar ahora — 120,00 €</a>
      </div>
    `),
  },
  {
    id: 'budget_request_user',
    name: 'Solicitud de Presupuesto — Cliente',
    category: 'PRESUPUESTOS',
    html: base('Solicitud de Presupuesto Recibida', `
      <h2 style="color:#1a5276;margin:0 0 16px;">Hemos recibido tu solicitud</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Laura Fernández</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Gracias por contactar con Náyade Experiences. Hemos recibido tu solicitud de presupuesto para <strong>Actividad de team building acuático</strong> para <strong>25 personas</strong>.</p>
      <p style="color:#374151;margin:0 0 20px;">Nuestro equipo la revisará y te enviará una propuesta personalizada en un plazo de 24-48 horas.</p>
    `),
  },
  {
    id: 'budget_request_admin',
    name: 'Solicitud de Presupuesto — Interno',
    category: 'PRESUPUESTOS',
    html: base('[INTERNO] Nueva Solicitud de Presupuesto', `
      <h2 style="color:#1a5276;margin:0 0 16px;">[ALERTA INTERNA] Nueva solicitud de presupuesto</h2>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;background:#f8f9fa;"><strong>Cliente</strong></td><td style="padding:8px;background:#f8f9fa;">Laura Fernández</td></tr>
        <tr><td style="padding:8px;background:#fff;border-top:1px solid #e5e7eb;"><strong>Email</strong></td><td style="padding:8px;background:#fff;border-top:1px solid #e5e7eb;">laura@empresa.com</td></tr>
        <tr><td style="padding:8px;background:#f8f9fa;border-top:1px solid #e5e7eb;"><strong>Actividad</strong></td><td style="padding:8px;background:#f8f9fa;border-top:1px solid #e5e7eb;">Team building acuático · 25 personas</td></tr>
      </table>
      <div style="text-align:center;">
        <a href="https://nayadeexperiences.es/admin/crm?tab=leads" style="background:#1a5276;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Ver en el CRM</a>
      </div>
    `),
  },
  {
    id: 'quote_sent',
    name: 'Presupuesto Enviado al Cliente',
    category: 'PRESUPUESTOS',
    html: base('Tu presupuesto personalizado', `
      <h2 style="color:#1a5276;margin:0 0 16px;">Tu presupuesto está listo</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Laura Fernández</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Adjunto encontrarás el presupuesto <strong>PRE-2026-0015</strong> para <strong>Team Building Acuático</strong> (25 personas).</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
        <tr style="background:#1a5276;color:#fff;"><th style="padding:10px;text-align:left;">Concepto</th><th style="padding:10px;text-align:right;">Total</th></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">Kayak doble (12 uds.)</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">420,00 €</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">SUP (8 uds.)</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">240,00 €</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">Monitor (4h)</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">240,00 €</td></tr>
        <tr style="background:#f8f9fa;font-weight:700;"><td style="padding:10px;" colspan="1">TOTAL (IVA incl.)</td><td style="padding:10px;text-align:right;color:#d4ac0d;">1.089,00 €</td></tr>
      </table>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://nayadeexperiences.es/pago/PRE-2026-0015" style="background:#d4ac0d;color:#1a1a1a;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">Aceptar y pagar</a>
      </div>
    `),
  },
  {
    id: 'cancellation_received',
    name: 'Anulación Recibida',
    category: 'ANULACIONES',
    html: base('Solicitud de Anulación Recibida', `
      <h2 style="color:#1a5276;margin:0 0 16px;">Hemos recibido tu solicitud de anulación</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Roberto Jiménez</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Hemos registrado tu solicitud de anulación para la reserva <strong>NAY-2026-0038</strong>. Nuestro equipo la revisará en un plazo de 2-3 días hábiles.</p>
      <p style="color:#374151;margin:0 0 20px;"><strong>Motivo indicado:</strong> Enfermedad acreditada con parte médico</p>
      <p style="color:#6b7280;font-size:12px;">Referencia de anulación: <strong>#23</strong></p>
    `),
  },
  {
    id: 'cancellation_rejected',
    name: 'Anulación Rechazada',
    category: 'ANULACIONES',
    html: base('Solicitud de Anulación — Resolución', `
      <h2 style="color:#dc2626;margin:0 0 16px;">Solicitud de anulación no aceptada</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Roberto Jiménez</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Tras revisar tu solicitud de anulación <strong>#23</strong>, lamentamos informarte de que no podemos aceptarla:</p>
      <div style="background:#fef2f2;border-left:4px solid #dc2626;padding:16px;border-radius:0 6px 6px 0;margin:0 0 20px;">
        <p style="margin:0;color:#374151;">La solicitud fue recibida fuera del plazo de cancelación establecido en nuestras condiciones.</p>
      </div>
    `),
  },
  {
    id: 'cancellation_accepted_refund',
    name: 'Anulación Aceptada — Devolución',
    category: 'ANULACIONES',
    html: base('Anulación Aceptada — Devolución', `
      <h2 style="color:#16a34a;margin:0 0 16px;">Tu anulación ha sido aceptada</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Roberto Jiménez</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Hemos aceptado tu solicitud de anulación <strong>#23</strong>. Procederemos a la devolución de <strong style="color:#d4ac0d;">89,00 €</strong> en un plazo de 5-10 días hábiles.</p>
    `),
  },
  {
    id: 'cancellation_accepted_voucher',
    name: 'Anulación Aceptada — Bono',
    category: 'ANULACIONES',
    html: base('Anulación Aceptada — Bono de Compensación', `
      <h2 style="color:#16a34a;margin:0 0 16px;">Tu bono de compensación</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Roberto Jiménez</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Hemos emitido un bono de compensación por valor de <strong style="color:#d4ac0d;">89,00 €</strong> para <strong>Wakeboard para principiantes</strong>.</p>
      <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:8px;padding:20px;text-align:center;margin:0 0 20px;">
        <p style="margin:0 0 8px;font-size:13px;color:#374151;">Código de bono</p>
        <p style="margin:0;font-size:24px;font-weight:700;color:#1a5276;letter-spacing:2px;font-family:monospace;">BON-2026-XK7F2A</p>
        <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Válido hasta: 31 de diciembre de 2026</p>
      </div>
    `),
  },
  {
    id: 'cancellation_documentation',
    name: 'Documentación Requerida',
    category: 'ANULACIONES',
    html: base('Documentación Requerida para tu Anulación', `
      <h2 style="color:#d97706;margin:0 0 16px;">Necesitamos documentación adicional</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Roberto Jiménez</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Para continuar con la revisión de tu solicitud de anulación <strong>#23</strong>, necesitamos:</p>
      <div style="background:#fffbeb;border-left:4px solid #d97706;padding:16px;border-radius:0 6px 6px 0;margin:0 0 20px;">
        <p style="margin:0;color:#374151;">1. Parte médico o informe del médico que acredite la enfermedad<br/>2. DNI del titular de la reserva</p>
      </div>
    `),
  },
  {
    id: 'tpv_ticket',
    name: 'Ticket de Compra TPV',
    category: 'TPV',
    html: base('Tu ticket de compra', `
      <h2 style="color:#1a5276;margin:0 0 16px;">Gracias por tu compra</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Isabel Torres</strong>,</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
        <tr style="background:#1a5276;color:#fff;"><th style="padding:10px;text-align:left;">Artículo</th><th style="padding:10px;text-align:center;">Uds.</th><th style="padding:10px;text-align:right;">Total</th></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">Wakeboard 1h</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">2</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">70,00 €</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">Alquiler neopreno</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">2</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">16,00 €</td></tr>
        <tr style="background:#f8f9fa;font-weight:700;"><td style="padding:10px;" colspan="2">TOTAL</td><td style="padding:10px;text-align:right;color:#d4ac0d;">86,00 €</td></tr>
      </table>
      <p style="color:#6b7280;font-size:12px;">Ticket: <strong>T-2026-0847</strong> · Pago: Tarjeta</p>
    `),
  },
  {
    id: 'coupon_received',
    name: 'Canje de Cupón — Solicitud Recibida',
    category: 'TICKETING',
    html: base('Solicitud de Canje Recibida', `
      <h2 style="color:#1a5276;margin:0 0 16px;">Hemos recibido tu solicitud de canje</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Miguel Ángel Ruiz</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Hemos registrado tu solicitud de canje para el <strong>22 de agosto de 2026</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
        <tr style="background:#1a5276;color:#fff;"><th style="padding:8px;text-align:left;">Proveedor</th><th style="padding:8px;text-align:left;">Código</th></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb;">Groupon</td><td style="padding:8px;border-bottom:1px solid #e5e7eb;font-family:monospace;">GV-2026-ABC123</td></tr>
        <tr><td style="padding:8px;">Groupon</td><td style="padding:8px;font-family:monospace;">GV-2026-DEF456</td></tr>
      </table>
      <p style="color:#6b7280;font-size:12px;">Referencia: <strong>TKT-2026-0091</strong></p>
    `),
  },
  {
    id: 'coupon_postponed',
    name: 'Canje de Cupón — Sin Disponibilidad',
    category: 'TICKETING',
    html: base('Información sobre tu solicitud de canje', `
      <h2 style="color:#d97706;margin:0 0 16px;">Sin disponibilidad para la fecha solicitada</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>Miguel Ángel Ruiz</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">No hay disponibilidad para el <strong>22 de agosto de 2026</strong> para <strong>Wakeboard 1 hora</strong>. Tu solicitud queda en estado <strong>Pendiente</strong>.</p>
      <p style="color:#374151;">Código: <code style="background:#f3f4f6;padding:3px 8px;border-radius:4px;font-family:monospace;">GV-2026-ABC123</code> (Groupon)</p>
    `),
  },
  {
    id: 'coupon_internal_alert',
    name: 'Canje de Cupón — Alerta Interna',
    category: 'TICKETING',
    html: base('[INTERNO] Nuevo envío de cupones', `
      <h2 style="color:#1a5276;margin:0 0 16px;">[TICKETING] Nuevo envío de cupones</h2>
      <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;background:#f8f9fa;"><strong>Cliente</strong></td><td style="padding:8px;background:#f8f9fa;">Miguel Ángel Ruiz · miguel@ejemplo.com · 634 567 890</td></tr>
        <tr><td style="padding:8px;background:#fff;border-top:1px solid #e5e7eb;"><strong>Fecha solicitada</strong></td><td style="padding:8px;background:#fff;border-top:1px solid #e5e7eb;">22 de agosto de 2026</td></tr>
      </table>
      <div style="text-align:center;">
        <a href="https://nayadeexperiences.es/admin/marketing/cupones" style="background:#1a5276;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Ver en el CRM</a>
      </div>
    `),
  },
  {
    id: 'invite',
    name: 'Invitación de Usuario',
    category: 'SISTEMA',
    html: base('Invitación a Náyade Experiences', `
      <h2 style="color:#1a5276;margin:0 0 16px;">Te invitamos a unirte</h2>
      <p style="color:#374151;margin:0 0 20px;">El equipo de <strong>Náyade Experiences</strong> te invita a acceder a la plataforma de gestión.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://nayadeexperiences.es/invitacion?token=abc123xyz" style="background:#1a5276;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">Aceptar invitación</a>
      </div>
      <p style="color:#6b7280;font-size:12px;text-align:center;">Este enlace caduca en 48 horas.</p>
    `),
  },
  {
    id: 'password_reset',
    name: 'Recuperación de Contraseña',
    category: 'SISTEMA',
    html: base('Recuperación de Contraseña', `
      <h2 style="color:#1a5276;margin:0 0 16px;">Restablece tu contraseña</h2>
      <p style="color:#374151;margin:0 0 12px;">Hola <strong>María García</strong>,</p>
      <p style="color:#374151;margin:0 0 20px;">Hemos recibido una solicitud para restablecer tu contraseña. Haz clic en el botón para continuar:</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://nayadeexperiences.es/reset-password?token=xyz789abc" style="background:#1a5276;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">Restablecer contraseña</a>
      </div>
      <p style="color:#6b7280;font-size:12px;text-align:center;">Si no solicitaste este cambio, ignora este email. El enlace caduca en 1 hora.</p>
    `),
  },
];

// ── Send all ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📧 Enviando ${TEMPLATES.length} plantillas de prueba a ${TO_EMAIL}\n`);
  console.log(`SMTP: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} (user: ${process.env.SMTP_USER})\n`);

  const results = [];
  for (const tpl of TEMPLATES) {
    try {
      await sendMail(
        TO_EMAIL,
        `[PRUEBA ${tpl.category}] ${tpl.name} · Náyade Experiences`,
        tpl.html
      );
      console.log(`  ✅ ${tpl.name}`);
      results.push({ id: tpl.id, name: tpl.name, ok: true });
    } catch (err) {
      console.error(`  ❌ ${tpl.name}: ${err.message}`);
      results.push({ id: tpl.id, name: tpl.name, ok: false, error: err.message });
    }
  }

  const sent = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n📊 Resultado: ${sent}/${TEMPLATES.length} enviadas · ${failed} fallaron\n`);
}

main().catch(console.error);
