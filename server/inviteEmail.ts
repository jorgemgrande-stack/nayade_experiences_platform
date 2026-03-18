import nodemailer from "nodemailer";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn("[InviteEmail] SMTP not configured, skipping email send");
    return null;
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  monitor: "Monitor",
  agente: "Agente Comercial",
  user: "Usuario",
};

export async function sendInviteEmail(params: {
  name: string;
  email: string;
  setPasswordUrl: string;
  role: string;
}) {
  const transporter = getTransporter();
  if (!transporter) return false;

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@nayadeexperiences.es";
  const roleLabel = ROLE_LABELS[params.role] ?? params.role;

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bienvenido a Náyade Experiences</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- Header azul -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a3a6b 0%,#2563eb 100%);padding:40px 40px 30px;text-align:center;">
            <div style="font-size:36px;font-weight:900;color:#ffffff;letter-spacing:2px;font-family:Georgia,serif;">NÁYADE</div>
            <div style="font-size:13px;color:rgba(255,255,255,0.8);letter-spacing:4px;text-transform:uppercase;margin-top:4px;">Experiences</div>
          </td>
        </tr>
        <!-- Contenido -->
        <tr>
          <td style="padding:40px;">
            <h1 style="color:#1a3a6b;font-size:24px;margin:0 0 16px;font-weight:700;">¡Bienvenido al equipo, ${params.name}!</h1>
            <p style="color:#4b5563;font-size:15px;line-height:1.7;margin:0 0 16px;">
              Se ha creado una cuenta para ti en la plataforma de gestión de <strong>Náyade Experiences</strong> con el rol de <strong>${roleLabel}</strong>.
            </p>
            <p style="color:#4b5563;font-size:15px;line-height:1.7;margin:0 0 32px;">
              Para activar tu cuenta y establecer tu contraseña, haz clic en el botón de abajo. Este enlace es válido durante <strong>72 horas</strong>.
            </p>
            <!-- CTA -->
            <div style="text-align:center;margin:0 0 32px;">
              <a href="${params.setPasswordUrl}" style="display:inline-block;background:#f97316;color:#ffffff;font-size:16px;font-weight:700;padding:16px 40px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
                Establecer mi contraseña →
              </a>
            </div>
            <!-- Info adicional -->
            <div style="background:#f0f4ff;border-left:4px solid #2563eb;border-radius:4px;padding:16px 20px;margin:0 0 24px;">
              <p style="color:#1a3a6b;font-size:13px;margin:0;line-height:1.6;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
                <a href="${params.setPasswordUrl}" style="color:#2563eb;word-break:break-all;font-size:12px;">${params.setPasswordUrl}</a>
              </p>
            </div>
            <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0;">
              Si no esperabas este email, puedes ignorarlo con seguridad. Si tienes dudas, contacta con el administrador del sistema.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;text-align:center;">
            <p style="color:#9ca3af;font-size:12px;margin:0;">
              Hotel Náyade · Los Ángeles de San Rafael, El Espinar, Segovia<br/>
              <a href="https://hotelnayade.es" style="color:#2563eb;text-decoration:none;">HotelNayade.es</a> · 
              <a href="tel:+34919041947" style="color:#2563eb;text-decoration:none;">+34 919 041 947</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"Náyade Experiences" <${from}>`,
      to: params.email,
      subject: `Bienvenido a Náyade Experiences — Activa tu cuenta`,
      html,
      text: `Hola ${params.name},\n\nSe ha creado una cuenta para ti en Náyade Experiences con el rol de ${roleLabel}.\n\nEstablece tu contraseña aquí: ${params.setPasswordUrl}\n\nEste enlace es válido durante 72 horas.\n\nNáyade Experiences`,
    });
    console.log(`[InviteEmail] Sent to ${params.email}`);
    return true;
  } catch (err) {
    console.error("[InviteEmail] Error sending:", err);
    return false;
  }
}
