/**
 * Enviar las 3 plantillas internas/sistema restantes con pausa entre envíos
 */
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const TO_EMAIL = 'reservas@nayadeexperiences.es';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function base(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#1a5276;padding:28px 32px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">Náyade Experiences</h1>
          <p style="margin:4px 0 0;color:#d4ac0d;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Aventura · Naturaleza · Bienestar</p>
        </td></tr>
        <tr><td style="padding:32px;">${bodyHtml}</td></tr>
        <tr><td style="background:#2c3e50;padding:20px 32px;text-align:center;">
          <p style="margin:0;color:#94a3b8;font-size:11px;">© ${new Date().getFullYear()} Náyade Experiences · Todos los derechos reservados</p>
          <p style="margin:4px 0 0;color:#64748b;font-size:10px;">Plantilla de sistema — email de prueba</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const REMAINING = [
  {
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
    name: 'Invitación de Usuario',
    category: 'SISTEMA',
    html: base('Invitación a Náyade Experiences', `
      <h2 style="color:#1a5276;margin:0 0 16px;">Te invitamos a unirte</h2>
      <p style="color:#374151;margin:0 0 20px;">El equipo de <strong>Náyade Experiences</strong> te invita a acceder a la plataforma de gestión.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="https://nayadeexperiences.es/set-password?token=abc123xyz" style="background:#1a5276;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">Activar cuenta</a>
      </div>
      <p style="color:#6b7280;font-size:12px;text-align:center;">Este enlace caduca en 48 horas.</p>
    `),
  },
  {
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

async function main() {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  console.log(`\n📧 Enviando 3 plantillas restantes a ${TO_EMAIL}\n`);

  for (const tpl of REMAINING) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: TO_EMAIL,
        subject: `[PRUEBA ${tpl.category}] ${tpl.name} · Náyade Experiences`,
        html: tpl.html,
      });
      console.log(`  ✅ ${tpl.name}`);
    } catch (err) {
      console.error(`  ❌ ${tpl.name}: ${err.message}`);
    }
    // Pausa de 5 segundos entre envíos para evitar rate limiting
    await sleep(5000);
  }
  console.log('\n✅ Completado\n');
}

main().catch(console.error);
