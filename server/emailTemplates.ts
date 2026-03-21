/**
 * emailTemplates.ts — Plantillas HTML corporativas de Náyade Experiences.
 *
 * Todas las plantillas comparten:
 *  - Logo: CDN Manus
 *  - Colores: azul marino #1e3a6e, naranja #f97316
 *  - Tipografía: Arial/Helvetica (compatible con todos los clientes de correo)
 *  - Footer con datos de contacto reales
 *
 * Logo CDN: https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/logo-nayade_1c84e3f7.jpg
 */

const LOGO_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/logo-nayade_1c84e3f7.jpg";
const BRAND_BLUE = "#1e3a6e";
const BRAND_ORANGE = "#f97316";
const BRAND_LIGHT_BLUE = "#e8eef7";

// ─── Helper: cabecera corporativa ────────────────────────────────────────────
function emailHeader(subtitle?: string): string {
  return `
  <tr>
    <td style="background:${BRAND_BLUE};padding:32px 40px 24px;text-align:center;">
      <img src="${LOGO_URL}" alt="Hotel Náyade" width="100" height="100"
           style="border-radius:50%;border:3px solid ${BRAND_ORANGE};display:block;margin:0 auto 16px;" />
      <div style="color:#ffffff;font-size:22px;font-weight:900;letter-spacing:2px;font-family:Georgia,serif;">NÁYADE</div>
      <div style="color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:4px;text-transform:uppercase;margin-top:2px;">Experiences</div>
      ${subtitle ? `<div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:8px;">${subtitle}</div>` : ""}
    </td>
  </tr>`;
}

// ─── Helper: pie de página corporativo ───────────────────────────────────────
function emailFooter(): string {
  return `
  <tr>
    <td style="background:#f0f4f8;padding:24px 40px;border-top:3px solid ${BRAND_ORANGE};text-align:center;">
      <p style="color:#6b7280;font-size:12px;margin:0 0 6px;line-height:1.6;">
        <strong style="color:${BRAND_BLUE};">Hotel Náyade ★★★</strong><br/>
        Los Ángeles de San Rafael, El Espinar, Segovia
      </p>
      <p style="color:#9ca3af;font-size:11px;margin:0;line-height:1.8;">
        <a href="tel:+34930347791" style="color:${BRAND_BLUE};text-decoration:none;">+34 930 34 77 91</a>
        &nbsp;·&nbsp;
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_BLUE};text-decoration:none;">reservas@nayadeexperiences.es</a>
        &nbsp;·&nbsp;
        <a href="https://hotelnayade.es" style="color:${BRAND_BLUE};text-decoration:none;">HotelNayade.es</a>
      </p>
      <p style="color:#d1d5db;font-size:10px;margin:12px 0 0;">
        © ${new Date().getFullYear()} Náyade Experiences · Todos los derechos reservados
      </p>
    </td>
  </tr>`;
}

// ─── Helper: wrapper HTML completo ───────────────────────────────────────────
function emailWrapper(title: string, bodyRows: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.10);max-width:600px;">
        ${bodyRows}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Helper: fila de detalle ──────────────────────────────────────────────────
function detailRow(icon: string, label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="28" style="color:#9ca3af;font-size:16px;vertical-align:middle;">${icon}</td>
        <td style="color:#6b7280;font-size:13px;vertical-align:middle;">${label}</td>
        <td align="right" style="color:${BRAND_BLUE};font-size:14px;font-weight:700;vertical-align:middle;">${value}</td>
      </tr></table>
    </td>
  </tr>`;
}

// ─── Helper: bloque de alerta ─────────────────────────────────────────────────
function alertBlock(type: "success" | "warning" | "error", title: string, body: string): string {
  const colors = {
    success: { bg: "#f0fdf4", border: "#86efac", title: "#166534", body: "#14532d" },
    warning: { bg: "#fefce8", border: "#fde047", title: "#854d0e", body: "#713f12" },
    error:   { bg: "#fef2f2", border: "#fca5a5", title: "#991b1b", body: "#7f1d1d" },
  };
  const c = colors[type];
  return `<div style="background:${c.bg};border:1px solid ${c.border};border-radius:8px;padding:16px 20px;margin:20px 0;">
    <p style="margin:0 0 4px;color:${c.title};font-weight:700;font-size:14px;">${title}</p>
    <p style="margin:0;color:${c.body};font-size:13px;line-height:1.6;">${body}</p>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 1: Confirmación de reserva de experiencia/pack (pago Redsys OK)
// ═══════════════════════════════════════════════════════════════════════════════
export interface ReservationConfirmData {
  merchantOrder: string;
  productName: string;
  customerName: string;
  date: string;
  people: number;
  amount: string;
  extras?: string;
}

export function buildReservationConfirmHtml(d: ReservationConfirmData): string {
  const body = `
    ${emailHeader("Confirmación de Reserva")}
    <tr><td style="padding:32px 40px 0;">
      <p style="color:#1e293b;font-size:16px;margin:0 0 8px;">Hola <strong>${d.customerName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 24px;line-height:1.7;">
        Tu reserva ha sido <strong style="color:#166534;">confirmada</strong> y el pago procesado correctamente.
        ¡Te esperamos para vivir una experiencia única en Náyade!
      </p>
    </td></tr>
    <tr><td style="padding:0 40px 8px;">
      <div style="background:${BRAND_LIGHT_BLUE};border-radius:10px;padding:20px 24px;">
        <p style="color:${BRAND_BLUE};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Detalles de tu reserva</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${detailRow("🎯", "Experiencia", d.productName)}
          ${detailRow("📅", "Fecha", d.date)}
          ${detailRow("👥", "Personas", `${d.people} persona${d.people !== 1 ? "s" : ""}`)}
          ${d.extras && d.extras !== "Ninguno" ? detailRow("✨", "Extras", d.extras) : ""}
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:${BRAND_ORANGE};border-radius:8px;">
          <tr>
            <td style="padding:14px 20px;color:#ffffff;font-size:13px;">Total pagado</td>
            <td align="right" style="padding:14px 20px;color:#ffffff;font-size:22px;font-weight:900;">${d.amount}</td>
          </tr>
        </table>
      </div>
    </td></tr>
    <tr><td style="padding:16px 40px 8px;">
      <div style="background:#f8fafc;border-left:4px solid ${BRAND_ORANGE};border-radius:4px;padding:14px 18px;">
        <p style="color:#374151;font-size:13px;margin:0;line-height:1.6;">
          <strong>Referencia:</strong> ${d.merchantOrder}<br/>
          Guarda este número para cualquier consulta sobre tu reserva.
        </p>
      </div>
    </td></tr>
    <tr><td style="padding:16px 40px 32px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;">
        ¿Necesitas modificar tu reserva? Contáctanos en
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_BLUE};text-decoration:none;">reservas@nayadeexperiences.es</a>
        o llámanos al <a href="tel:+34930347791" style="color:${BRAND_BLUE};text-decoration:none;">+34 930 34 77 91</a>.
      </p>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper("Reserva Confirmada — Náyade Experiences", body);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 2: Pago fallido de experiencia/pack (Redsys KO)
// ═══════════════════════════════════════════════════════════════════════════════
export interface ReservationFailedData {
  merchantOrder: string;
  productName: string;
  customerName: string;
  responseCode: string;
}

export function buildReservationFailedHtml(d: ReservationFailedData): string {
  const body = `
    ${emailHeader("Pago No Completado")}
    <tr><td style="padding:32px 40px 24px;">
      <p style="color:#1e293b;font-size:16px;margin:0 0 8px;">Hola <strong>${d.customerName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 20px;line-height:1.7;">
        Lamentablemente no hemos podido procesar el pago de tu reserva para
        <strong>${d.productName}</strong>. Esto puede deberse a un problema temporal con tu banco.
      </p>
      ${alertBlock("error", "Pago no procesado", `Referencia: <strong>${d.merchantOrder}</strong> · Código: ${d.responseCode}`)}
      <p style="color:#6b7280;font-size:14px;margin:0 0 8px;line-height:1.7;">Puedes intentarlo de nuevo o contactarnos para ayudarte a completar la reserva:</p>
      <p style="margin:0;">
        <a href="mailto:reservas@nayadeexperiences.es"
           style="display:inline-block;background:${BRAND_ORANGE};color:#ffffff;font-size:14px;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;margin-right:8px;">
          Contactar ahora
        </a>
      </p>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper("Pago No Completado — Náyade Experiences", body);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 3: Reserva de restaurante recibida (cliente)
// ═══════════════════════════════════════════════════════════════════════════════
export interface RestaurantBookingData {
  guestName: string;
  restaurantName: string;
  date: string;
  time: string;
  guests: number;
  locator: string;
  depositAmount: string;
  requiresPayment: boolean;
}

export function buildRestaurantConfirmHtml(d: RestaurantBookingData): string {
  const statusBlock = d.requiresPayment
    ? alertBlock("warning", "⚠️ Depósito pendiente",
        `Tu reserva está registrada pero necesita el pago del depósito (<strong>${d.depositAmount} €</strong>) para quedar confirmada. Recibirás un email con el enlace de pago en breve.`)
    : alertBlock("success", "✅ Reserva confirmada",
        "Tu reserva está confirmada. ¡Te esperamos en el restaurante!");

  const body = `
    ${emailHeader(`Reserva en ${d.restaurantName}`)}
    <tr><td style="padding:32px 40px 0;">
      <p style="color:#1e293b;font-size:16px;margin:0 0 8px;">Hola <strong>${d.guestName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 20px;line-height:1.7;">
        Hemos recibido tu solicitud de reserva en <strong>${d.restaurantName}</strong>. Aquí tienes el resumen:
      </p>
    </td></tr>
    <tr><td style="padding:0 40px 8px;">
      <div style="background:${BRAND_LIGHT_BLUE};border-radius:10px;padding:20px 24px;">
        <p style="color:${BRAND_BLUE};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Detalles de tu reserva</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${detailRow("🍽️", "Restaurante", d.restaurantName)}
          ${detailRow("📅", "Fecha", d.date)}
          ${detailRow("🕐", "Hora", d.time)}
          ${detailRow("👥", "Comensales", `${d.guests} persona${d.guests !== 1 ? "s" : ""}`)}
          ${detailRow("🔑", "Localizador", `<span style="font-size:18px;color:${BRAND_ORANGE};">${d.locator}</span>`)}
        </table>
      </div>
    </td></tr>
    <tr><td style="padding:8px 40px 32px;">
      ${statusBlock}
      <p style="color:#9ca3af;font-size:13px;margin:16px 0 0;line-height:1.6;">
        ¿Necesitas modificar tu reserva? Contáctanos en
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_BLUE};text-decoration:none;">reservas@nayadeexperiences.es</a>
        o llámanos al <a href="tel:+34930347791" style="color:${BRAND_BLUE};text-decoration:none;">+34 930 34 77 91</a>.
      </p>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper(`Reserva en ${d.restaurantName} — Náyade Experiences`, body);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 4: Link de pago de depósito de restaurante (cliente)
// ═══════════════════════════════════════════════════════════════════════════════
export interface RestaurantPaymentLinkData {
  guestName: string;
  guestEmail: string;
  restaurantName: string;
  date: string;
  time: string;
  guests: number;
  locator: string;
  depositAmount: string;
  redsysUrl: string;
  merchantParams: string;
  signatureVersion: string;
  signature: string;
}

export function buildRestaurantPaymentLinkHtml(d: RestaurantPaymentLinkData): string {
  const body = `
    ${emailHeader(`Completa tu reserva en ${d.restaurantName}`)}
    <tr><td style="padding:32px 40px 0;">
      <p style="color:#1e293b;font-size:16px;margin:0 0 8px;">Hola <strong>${d.guestName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 20px;line-height:1.7;">
        Tu reserva en <strong>${d.restaurantName}</strong> está casi lista.
        Para confirmarla, necesitas abonar el depósito de <strong style="color:${BRAND_ORANGE};">${d.depositAmount} €</strong>.
      </p>
    </td></tr>
    <tr><td style="padding:0 40px 8px;">
      <div style="background:${BRAND_LIGHT_BLUE};border-radius:10px;padding:20px 24px;">
        <p style="color:${BRAND_BLUE};font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Detalles de tu reserva</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${detailRow("🍽️", "Restaurante", d.restaurantName)}
          ${detailRow("📅", "Fecha", d.date)}
          ${detailRow("🕐", "Hora", d.time)}
          ${detailRow("👥", "Comensales", `${d.guests} persona${d.guests !== 1 ? "s" : ""}`)}
          ${detailRow("🔑", "Localizador", `<span style="font-size:18px;color:${BRAND_ORANGE};">${d.locator}</span>`)}
        </table>
      </div>
    </td></tr>
    <tr><td style="padding:16px 40px 32px;text-align:center;">
      <p style="color:#374151;font-size:14px;margin:0 0 20px;">Haz clic en el botón para pagar el depósito de forma segura con Redsys:</p>
      <form method="POST" action="${d.redsysUrl}" style="display:inline;">
        <input type="hidden" name="Ds_SignatureVersion" value="${d.signatureVersion}" />
        <input type="hidden" name="Ds_MerchantParameters" value="${d.merchantParams}" />
        <input type="hidden" name="Ds_Signature" value="${d.signature}" />
        <button type="submit"
          style="background:${BRAND_ORANGE};color:#ffffff;border:none;padding:16px 40px;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;letter-spacing:0.5px;">
          Pagar depósito (${d.depositAmount} €) →
        </button>
      </form>
      <p style="color:#9ca3af;font-size:12px;margin:16px 0 0;">
        Pago seguro procesado por Redsys (Banco Sabadell). Tu reserva quedará confirmada automáticamente.
      </p>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper(`Completa tu reserva — ${d.restaurantName} — Náyade Experiences`, body);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 5: Invitación / activación de cuenta (usuario del backoffice)
// ═══════════════════════════════════════════════════════════════════════════════
export interface InviteEmailData {
  name: string;
  role: string;
  setPasswordUrl: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  adminrest: "Responsable de Restaurante",
  monitor: "Monitor",
  agente: "Agente Comercial",
  user: "Usuario",
};

export function buildInviteHtml(d: InviteEmailData): string {
  const roleLabel = ROLE_LABELS[d.role] ?? d.role;
  const body = `
    ${emailHeader("Plataforma de Gestión")}
    <tr><td style="padding:32px 40px 0;">
      <h2 style="color:${BRAND_BLUE};font-size:22px;margin:0 0 12px;font-weight:700;">¡Bienvenido al equipo, ${d.name}!</h2>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 16px;">
        Se ha creado una cuenta para ti en la plataforma de gestión de <strong>Náyade Experiences</strong>
        con el rol de <strong style="color:${BRAND_ORANGE};">${roleLabel}</strong>.
      </p>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 28px;">
        Para activar tu cuenta y establecer tu contraseña, haz clic en el botón de abajo.
        Este enlace es válido durante <strong>72 horas</strong>.
      </p>
      <div style="text-align:center;margin:0 0 28px;">
        <a href="${d.setPasswordUrl}"
           style="display:inline-block;background:${BRAND_ORANGE};color:#ffffff;font-size:16px;font-weight:700;padding:16px 40px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
          Establecer mi contraseña →
        </a>
      </div>
      <div style="background:#f8fafc;border-left:4px solid ${BRAND_BLUE};border-radius:4px;padding:14px 18px;margin:0 0 20px;">
        <p style="color:#374151;font-size:13px;margin:0;line-height:1.6;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
          <a href="${d.setPasswordUrl}" style="color:${BRAND_BLUE};word-break:break-all;font-size:12px;">${d.setPasswordUrl}</a>
        </p>
      </div>
      <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0 0 32px;">
        Si no esperabas este email, puedes ignorarlo con seguridad.
      </p>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper("Bienvenido a Náyade Experiences — Activa tu cuenta", body);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 6: Recuperación de contraseña
// ═══════════════════════════════════════════════════════════════════════════════
export interface PasswordResetData {
  name: string;
  resetUrl: string;
  expiryMinutes: number;
}

export function buildPasswordResetHtml(d: PasswordResetData): string {
  const body = `
    ${emailHeader("Recuperar Contraseña")}
    <tr><td style="padding:32px 40px 0;">
      <h2 style="color:${BRAND_BLUE};font-size:20px;margin:0 0 12px;font-weight:700;">Restablecer contraseña</h2>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 12px;">Hola <strong>${d.name}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 28px;">
        Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en Náyade Experiences.
        Haz clic en el botón de abajo para crear una nueva contraseña:
      </p>
      <div style="text-align:center;margin:0 0 28px;">
        <a href="${d.resetUrl}"
           style="display:inline-block;background:${BRAND_ORANGE};color:#ffffff;font-size:16px;font-weight:700;padding:16px 40px;border-radius:8px;text-decoration:none;letter-spacing:0.5px;">
          Restablecer contraseña →
        </a>
      </div>
      ${alertBlock("warning", "⏱ Enlace temporal",
        `Este enlace caduca en <strong>${d.expiryMinutes} minutos</strong>. Si no solicitaste este cambio, puedes ignorar este mensaje.`)}
      <div style="background:#f8fafc;border-left:4px solid ${BRAND_BLUE};border-radius:4px;padding:14px 18px;margin:0 0 32px;">
        <p style="color:#374151;font-size:13px;margin:0;line-height:1.6;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
          <a href="${d.resetUrl}" style="color:${BRAND_BLUE};word-break:break-all;font-size:12px;">${d.resetUrl}</a>
        </p>
      </div>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper("Recuperar contraseña — Náyade Experiences", body);
}
