/**
 * emailTemplates.ts — Plantillas HTML premium de Náyade Experiences.
 *
 * Diseño aspiracional: gradiente azul marino, logo nuevo sin recuadro,
 * wave SVG decorativo, iconos SVG inline, tipografía impactante.
 *
 * Logo CDN: https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png
 */

const LOGO_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png";
const BRAND_BLUE     = "#0a1628";
const BRAND_MID_BLUE = "#1e3a6e";
const BRAND_ORANGE   = "#f97316";
const BRAND_LIGHT    = "#f0f4f8";

// ─── SVG icons inline (email-safe) ───────────────────────────────────────────
const SVG = {
  calendar: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  users:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  star:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="#f97316" stroke="#f97316" stroke-width="1" style="display:inline-block;vertical-align:middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  key:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>`,
  fork:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>`,
  clock:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  phone:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.81-.81a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.73 16a2 2 0 0 1 .27.92z"/></svg>`,
  mail:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  map:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  person:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  tag:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  chat:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  lock:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  check:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><polyline points="20 6 9 17 4 12"/></svg>`,
  alert:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  error:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  child:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><circle cx="12" cy="5" r="3"/><path d="M12 8v8"/><path d="M9 14l3 4 3-4"/></svg>`,
  ref:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
};

// ─── Helper: cabecera premium con gradiente ───────────────────────────────────
function emailHeader(subtitle?: string, tagline?: string): string {
  return `
  <tr>
    <td style="background:linear-gradient(135deg,${BRAND_BLUE} 0%,${BRAND_MID_BLUE} 60%,#1a4a8a 100%);padding:0;">
      <!-- Wave top decoration -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:36px 40px 0;text-align:center;">
          <!-- Logo circular con borde naranja -->
          <div style="display:inline-block;border-radius:50%;border:3px solid ${BRAND_ORANGE};padding:3px;box-shadow:0 0 0 1px rgba(249,115,22,0.3);">
            <img src="${LOGO_URL}" alt="Náyade Experiences" width="80" height="80"
                 style="display:block;border-radius:50%;object-fit:cover;" />
          </div>
          <div style="margin-top:16px;">
            <div style="color:#ffffff;font-size:28px;font-weight:900;letter-spacing:4px;font-family:Georgia,'Times New Roman',serif;text-shadow:0 2px 8px rgba(0,0,0,0.3);">NÁYADE</div>
            <div style="color:rgba(255,255,255,0.55);font-size:10px;letter-spacing:6px;text-transform:uppercase;margin-top:3px;font-family:Arial,sans-serif;">EXPERIENCES</div>
          </div>
          ${subtitle ? `<div style="display:inline-block;background:${BRAND_ORANGE};color:#ffffff;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:5px 18px;border-radius:20px;margin-top:16px;font-family:Arial,sans-serif;">${subtitle}</div>` : ""}
          ${tagline ? `<div style="color:rgba(255,255,255,0.65);font-size:13px;margin-top:10px;font-family:Arial,sans-serif;line-height:1.5;">${tagline}</div>` : ""}
        </td></tr>
        <!-- Wave SVG bottom -->
        <tr><td style="line-height:0;padding:0;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 40" preserveAspectRatio="none" width="600" height="40" style="display:block;">
            <path d="M0,20 C150,40 450,0 600,20 L600,40 L0,40 Z" fill="#ffffff"/>
          </svg>
        </td></tr>
      </table>
    </td>
  </tr>`;
}

// ─── Helper: pie de página premium ───────────────────────────────────────────
function emailFooter(): string {
  return `
  <tr>
    <td style="padding:0;">
      <!-- Wave top -->
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 30" preserveAspectRatio="none" width="600" height="30" style="display:block;">
        <path d="M0,15 C200,30 400,0 600,15 L600,0 L0,0 Z" fill="${BRAND_BLUE}"/>
      </svg>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_BLUE};">
        <tr><td style="padding:24px 40px;text-align:center;">
          <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 10px;font-family:Arial,sans-serif;line-height:1.8;">
            ${SVG.map}&nbsp;<span style="color:rgba(255,255,255,0.7);">Los Ángeles de San Rafael, El Espinar, Segovia</span>
          </p>
          <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 10px;font-family:Arial,sans-serif;">
            ${SVG.phone}&nbsp;<a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;">+34 930 34 77 91</a>
            &nbsp;&nbsp;${SVG.mail}&nbsp;<a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;">reservas@nayadeexperiences.es</a>
          </p>
          <p style="color:rgba(255,255,255,0.25);font-size:10px;margin:12px 0 0;font-family:Arial,sans-serif;letter-spacing:1px;">
            © ${new Date().getFullYear()} NÁYADE EXPERIENCES · TODOS LOS DERECHOS RESERVADOS
          </p>
        </td></tr>
      </table>
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
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(10,22,40,0.15);max-width:600px;">
        ${bodyRows}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Helper: fila de detalle premium ─────────────────────────────────────────
function detailRow(icon: string, label: string, value: string): string {
  return `<tr>
    <td style="padding:11px 0;border-bottom:1px solid #e8eef7;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="26" style="vertical-align:middle;">${icon}</td>
        <td style="color:#6b7280;font-size:13px;vertical-align:middle;font-family:Arial,sans-serif;">${label}</td>
        <td align="right" style="color:${BRAND_BLUE};font-size:13px;font-weight:700;vertical-align:middle;font-family:Arial,sans-serif;">${value}</td>
      </tr></table>
    </td>
  </tr>`;
}

// ─── Helper: bloque de estado ─────────────────────────────────────────────────
function statusBlock(type: "success" | "warning" | "error", title: string, body: string): string {
  const cfg = {
    success: { bg: "#f0fdf4", border: "#22c55e", icon: SVG.check,  titleColor: "#166534", bodyColor: "#15803d" },
    warning: { bg: "#fffbeb", border: "#f59e0b", icon: SVG.alert,  titleColor: "#92400e", bodyColor: "#b45309" },
    error:   { bg: "#fef2f2", border: "#ef4444", icon: SVG.error,  titleColor: "#991b1b", bodyColor: "#b91c1c" },
  };
  const c = cfg[type];
  return `<div style="background:${c.bg};border-left:4px solid ${c.border};border-radius:8px;padding:14px 18px;margin:20px 0;">
    <p style="margin:0 0 5px;color:${c.titleColor};font-weight:700;font-size:14px;font-family:Arial,sans-serif;">${c.icon}&nbsp;${title}</p>
    <p style="margin:0;color:${c.bodyColor};font-size:13px;line-height:1.6;font-family:Arial,sans-serif;">${body}</p>
  </div>`;
}

// ─── Helper: botón CTA premium ────────────────────────────────────────────────
function ctaButton(text: string, href: string): string {
  return `<div style="text-align:center;margin:28px 0;">
    <a href="${href}"
       style="display:inline-block;background:linear-gradient(135deg,${BRAND_ORANGE},#ea6c0a);color:#ffffff;font-size:15px;font-weight:700;padding:16px 44px;border-radius:50px;text-decoration:none;letter-spacing:0.5px;box-shadow:0 4px 15px rgba(249,115,22,0.4);font-family:Arial,sans-serif;">
      ${text} →
    </a>
  </div>`;
}

// ─── Helper: bloque de detalles con fondo ─────────────────────────────────────
function detailsCard(rows: string): string {
  return `<tr><td style="padding:0 40px 8px;">
    <div style="background:linear-gradient(135deg,#f0f4f8,#e8eef7);border-radius:12px;padding:20px 24px;border:1px solid #dce4f0;">
      <p style="color:${BRAND_MID_BLUE};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px;font-family:Arial,sans-serif;">Detalles</p>
      <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </div>
  </td></tr>`;
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
    ${emailHeader("Reserva Confirmada", "¡Tu aventura está lista!")}
    <tr><td style="padding:32px 40px 0;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.customerName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 20px;line-height:1.7;font-family:Arial,sans-serif;">
        Tu reserva ha sido <strong style="color:#166534;">confirmada</strong> y el pago procesado correctamente.
        ¡Te esperamos para vivir una experiencia única en el embalse de Los Ángeles de San Rafael!
      </p>
      ${statusBlock("success", "Pago procesado correctamente", "Tu plaza está reservada. Recibirás toda la información necesaria para el día de tu visita.")}
    </td></tr>
    ${detailsCard(`
      ${detailRow(SVG.star,     "Experiencia",  d.productName)}
      ${detailRow(SVG.calendar, "Fecha",        d.date)}
      ${detailRow(SVG.users,    "Personas",     `${d.people} persona${d.people !== 1 ? "s" : ""}`)}
      ${d.extras && d.extras !== "Ninguno" ? detailRow(SVG.tag, "Extras", d.extras) : ""}
    `)}
    <tr><td style="padding:8px 40px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,${BRAND_BLUE},${BRAND_MID_BLUE});border-radius:10px;overflow:hidden;">
        <tr>
          <td style="padding:16px 22px;color:rgba(255,255,255,0.7);font-size:13px;font-family:Arial,sans-serif;">Total pagado</td>
          <td align="right" style="padding:16px 22px;color:#ffffff;font-size:26px;font-weight:900;font-family:Georgia,serif;">${d.amount}</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 40px;">
      <div style="background:#f8fafc;border-left:4px solid ${BRAND_ORANGE};border-radius:6px;padding:14px 18px;">
        <p style="color:#374151;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
          ${SVG.ref}&nbsp;<strong>Referencia de reserva:</strong> <span style="color:${BRAND_ORANGE};font-weight:700;">${d.merchantOrder}</span><br/>
          <span style="color:#9ca3af;font-size:12px;">Guarda este número para cualquier consulta.</span>
        </p>
      </div>
    </td></tr>
    <tr><td style="padding:8px 40px 32px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        ¿Necesitas modificar tu reserva? Escríbenos a
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">reservas@nayadeexperiences.es</a>
        o llámanos al <a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">+34 930 34 77 91</a>.
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
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.customerName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 20px;line-height:1.7;font-family:Arial,sans-serif;">
        Lamentablemente no hemos podido procesar el pago de tu reserva para
        <strong>${d.productName}</strong>. Esto puede deberse a un problema temporal con tu banco.
      </p>
      ${statusBlock("error", "Pago no procesado", `Referencia: <strong>${d.merchantOrder}</strong> · Código: ${d.responseCode}`)}
      <p style="color:#6b7280;font-size:14px;margin:16px 0 0;line-height:1.7;font-family:Arial,sans-serif;">
        Puedes intentarlo de nuevo o contactarnos y te ayudamos a completar la reserva:
      </p>
      ${ctaButton("Contactar ahora", "mailto:reservas@nayadeexperiences.es")}
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
  const status = d.requiresPayment
    ? statusBlock("warning", "Depósito pendiente",
        `Tu reserva está registrada pero necesita el pago del depósito (<strong>${d.depositAmount} €</strong>) para quedar confirmada. Recibirás el enlace de pago en breve.`)
    : statusBlock("success", "Reserva confirmada",
        "¡Tu mesa está reservada! Te esperamos para disfrutar de la mejor gastronomía junto al lago.");

  const body = `
    ${emailHeader(`Mesa en ${d.restaurantName}`, "Gastronomía junto al lago")}
    <tr><td style="padding:32px 40px 0;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.guestName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 20px;line-height:1.7;font-family:Arial,sans-serif;">
        Hemos recibido tu solicitud de reserva en <strong>${d.restaurantName}</strong>. Aquí tienes el resumen:
      </p>
      ${status}
    </td></tr>
    ${detailsCard(`
      ${detailRow(SVG.fork,     "Restaurante",  d.restaurantName)}
      ${detailRow(SVG.calendar, "Fecha",        d.date)}
      ${detailRow(SVG.clock,    "Hora",         d.time)}
      ${detailRow(SVG.users,    "Comensales",   `${d.guests} persona${d.guests !== 1 ? "s" : ""}`)}
      ${detailRow(SVG.key,      "Localizador",  `<span style="font-size:17px;color:${BRAND_ORANGE};font-weight:900;">${d.locator}</span>`)}
    `)}
    <tr><td style="padding:8px 40px 32px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        ¿Necesitas modificar tu reserva? Escríbenos a
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">reservas@nayadeexperiences.es</a>
        o llámanos al <a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">+34 930 34 77 91</a>.
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
    ${emailHeader("Confirma tu Reserva", `Depósito de ${d.depositAmount} € pendiente`)}
    <tr><td style="padding:32px 40px 0;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.guestName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 20px;line-height:1.7;font-family:Arial,sans-serif;">
        Tu reserva en <strong>${d.restaurantName}</strong> está casi lista.
        Para confirmarla, abona el depósito de <strong style="color:${BRAND_ORANGE};font-size:17px;">${d.depositAmount} €</strong>.
      </p>
    </td></tr>
    ${detailsCard(`
      ${detailRow(SVG.fork,     "Restaurante",  d.restaurantName)}
      ${detailRow(SVG.calendar, "Fecha",        d.date)}
      ${detailRow(SVG.clock,    "Hora",         d.time)}
      ${detailRow(SVG.users,    "Comensales",   `${d.guests} persona${d.guests !== 1 ? "s" : ""}`)}
      ${detailRow(SVG.key,      "Localizador",  `<span style="font-size:17px;color:${BRAND_ORANGE};font-weight:900;">${d.locator}</span>`)}
    `)}
    <tr><td style="padding:16px 40px 32px;text-align:center;">
      <p style="color:#374151;font-size:14px;margin:0 0 20px;font-family:Arial,sans-serif;">Haz clic para pagar el depósito de forma segura:</p>
      <form method="POST" action="${d.redsysUrl}" style="display:inline;">
        <input type="hidden" name="Ds_SignatureVersion" value="${d.signatureVersion}" />
        <input type="hidden" name="Ds_MerchantParameters" value="${d.merchantParams}" />
        <input type="hidden" name="Ds_Signature" value="${d.signature}" />
        <button type="submit"
          style="background:linear-gradient(135deg,${BRAND_ORANGE},#ea6c0a);color:#ffffff;border:none;padding:16px 44px;border-radius:50px;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:0.5px;box-shadow:0 4px 15px rgba(249,115,22,0.4);font-family:Arial,sans-serif;">
          Pagar ${d.depositAmount} € →
        </button>
      </form>
      <p style="color:#9ca3af;font-size:12px;margin:16px 0 0;font-family:Arial,sans-serif;">
        Pago seguro procesado por Redsys. Tu reserva quedará confirmada automáticamente.
      </p>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper(`Confirma tu reserva — ${d.restaurantName} — Náyade Experiences`, body);
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
  admin:     "Administrador",
  adminrest: "Responsable de Restaurante",
  monitor:   "Monitor",
  agente:    "Agente Comercial",
  user:      "Usuario",
};

export function buildInviteHtml(d: InviteEmailData): string {
  const roleLabel = ROLE_LABELS[d.role] ?? d.role;
  const body = `
    ${emailHeader("Bienvenido al Equipo", "Plataforma de Gestión Náyade")}
    <tr><td style="padding:32px 40px 0;">
      <h2 style="color:${BRAND_BLUE};font-size:22px;margin:0 0 12px;font-weight:700;font-family:Georgia,serif;">¡Hola ${d.name}!</h2>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 16px;font-family:Arial,sans-serif;">
        Se ha creado una cuenta para ti en la plataforma de gestión de <strong>Náyade Experiences</strong>
        con el rol de:
      </p>
      <div style="display:inline-block;background:linear-gradient(135deg,${BRAND_BLUE},${BRAND_MID_BLUE});color:#ffffff;padding:8px 22px;border-radius:20px;font-size:13px;font-weight:700;letter-spacing:1px;margin:0 0 20px;font-family:Arial,sans-serif;">
        ${roleLabel}
      </div>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;font-family:Arial,sans-serif;">
        Para activar tu cuenta y establecer tu contraseña, haz clic en el botón de abajo.
        Este enlace es válido durante <strong>72 horas</strong>.
      </p>
      ${ctaButton("Activar mi cuenta", d.setPasswordUrl)}
      <div style="background:#f8fafc;border-left:4px solid ${BRAND_BLUE};border-radius:6px;padding:14px 18px;margin:0 0 20px;">
        <p style="color:#374151;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
          <a href="${d.setPasswordUrl}" style="color:${BRAND_ORANGE};word-break:break-all;font-size:12px;">${d.setPasswordUrl}</a>
        </p>
      </div>
      <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0 0 32px;font-family:Arial,sans-serif;">
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
      <h2 style="color:${BRAND_BLUE};font-size:20px;margin:0 0 12px;font-weight:700;font-family:Georgia,serif;">Restablecer contraseña</h2>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 12px;font-family:Arial,sans-serif;">Hola <strong>${d.name}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;font-family:Arial,sans-serif;">
        Hemos recibido una solicitud para restablecer la contraseña de tu cuenta.
        Haz clic en el botón de abajo para crear una nueva contraseña:
      </p>
      ${ctaButton("Restablecer contraseña", d.resetUrl)}
      ${statusBlock("warning", "Enlace temporal",
        `Este enlace caduca en <strong>${d.expiryMinutes} minutos</strong>. Si no solicitaste este cambio, puedes ignorar este mensaje.`)}
      <div style="background:#f8fafc;border-left:4px solid ${BRAND_BLUE};border-radius:6px;padding:14px 18px;margin:0 0 32px;">
        <p style="color:#374151;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
          <a href="${d.resetUrl}" style="color:${BRAND_ORANGE};word-break:break-all;font-size:12px;">${d.resetUrl}</a>
        </p>
      </div>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper("Recuperar contraseña — Náyade Experiences", body);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 7: Solicitud de presupuesto — Email al usuario (confirmación)
// ═══════════════════════════════════════════════════════════════════════════════
export interface BudgetRequestEmailData {
  name: string;
  email: string;
  phone: string;
  arrivalDate: string;
  adults: number;
  children: number;
  selectedCategory: string;
  selectedProduct: string;
  comments: string;
  submittedAt: string;
}

export function buildBudgetRequestUserHtml(d: BudgetRequestEmailData): string {
  const body = `
    ${emailHeader("Solicitud Recibida", "Tu experiencia perfecta está en camino")}
    <tr><td style="padding:32px 40px 0;">
      <h2 style="color:${BRAND_BLUE};font-size:22px;margin:0 0 12px;font-weight:700;font-family:Georgia,serif;">¡Hola ${d.name}!</h2>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 20px;font-family:Arial,sans-serif;">
        Hemos recibido tu solicitud de presupuesto. Nuestro equipo está preparando tu propuesta personalizada
        y te contactaremos en <strong style="color:${BRAND_BLUE};">menos de 24 horas</strong>.
      </p>
      ${statusBlock("success", "Solicitud recibida correctamente",
        "Revisaremos todos los detalles y te enviaremos una propuesta a medida para que disfrutes de la mejor experiencia posible.")}
    </td></tr>
    ${detailsCard(`
      ${detailRow(SVG.calendar, "Día de llegada",         d.arrivalDate)}
      ${detailRow(SVG.users,    "Adultos",                String(d.adults))}
      ${detailRow(SVG.child,    "Niños",                  String(d.children))}
      ${detailRow(SVG.tag,      "Categoría",              d.selectedCategory)}
      ${detailRow(SVG.star,     "Experiencia solicitada", d.selectedProduct)}
      ${d.comments ? detailRow(SVG.chat, "Comentarios", d.comments) : ""}
      ${detailRow(SVG.phone,    "Teléfono de contacto",   d.phone)}
    `)}
    <tr><td style="padding:8px 40px 32px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        ¿Necesitas modificar algún dato? Escríbenos a
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">reservas@nayadeexperiences.es</a>
        o llámanos al <a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">+34 930 34 77 91</a>.
      </p>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper("Solicitud de presupuesto recibida — Náyade Experiences", body);
}

export function buildBudgetRequestAdminHtml(d: BudgetRequestEmailData): string {
  const body = `
    ${emailHeader("Nueva Solicitud", "Acción requerida en menos de 24h")}
    <tr><td style="padding:32px 40px 0;">
      <h2 style="color:${BRAND_BLUE};font-size:20px;margin:0 0 12px;font-weight:700;font-family:Georgia,serif;">Nueva solicitud de presupuesto</h2>
      ${statusBlock("warning", "Acción requerida",
        "Se ha recibido una nueva solicitud de presupuesto. Contacta al cliente en menos de 24 horas.")}
    </td></tr>
    ${detailsCard(`
      ${detailRow(SVG.person,   "Nombre",                 d.name)}
      ${detailRow(SVG.mail,     "Email",                  d.email)}
      ${detailRow(SVG.phone,    "Teléfono",               d.phone)}
      ${detailRow(SVG.calendar, "Día de llegada",         d.arrivalDate)}
      ${detailRow(SVG.users,    "Adultos",                String(d.adults))}
      ${detailRow(SVG.child,    "Niños",                  String(d.children))}
      ${detailRow(SVG.tag,      "Categoría",              d.selectedCategory)}
      ${detailRow(SVG.star,     "Experiencia solicitada", d.selectedProduct)}
      ${d.comments ? detailRow(SVG.chat, "Comentarios", d.comments) : ""}
      ${detailRow(SVG.clock,    "Fecha de envío",         d.submittedAt)}
    `)}
    <tr><td style="padding:8px 40px 32px;">
      ${ctaButton("Contactar al cliente", `mailto:${d.email}`)}
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper("Nueva solicitud de presupuesto — Náyade Experiences", body);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 8: Presupuesto enviado al cliente (CRM → Cliente)
// ═══════════════════════════════════════════════════════════════════════════════
export interface QuoteEmailData {
  quoteNumber: string;
  title: string;
  clientName: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  validUntil?: Date;
  notes?: string;
  conditions?: string;
  paymentLinkUrl?: string;
}

export function buildQuoteHtml(d: QuoteEmailData): string {
  const itemRowsHtml = d.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:11px 0;border-bottom:1px solid #e8eef7;color:#374151;font-size:14px;font-family:Arial,sans-serif;">${item.description}</td>
          <td style="padding:11px 0;border-bottom:1px solid #e8eef7;text-align:center;color:#374151;font-size:14px;font-family:Arial,sans-serif;">${item.quantity}</td>
          <td style="padding:11px 0;border-bottom:1px solid #e8eef7;text-align:right;color:#374151;font-size:14px;font-family:Arial,sans-serif;">${Number(item.unitPrice).toFixed(2)} €</td>
          <td style="padding:11px 0;border-bottom:1px solid #e8eef7;text-align:right;color:${BRAND_ORANGE};font-size:14px;font-weight:700;font-family:Arial,sans-serif;">${Number(item.total).toFixed(2)} €</td>
        </tr>`
    )
    .join("");

  const totalsBlock = `<tr><td style="padding:0 40px 8px;">
    <div style="background:linear-gradient(135deg,#f0f4f8,#e8eef7);border-radius:12px;padding:20px 24px;border:1px solid #dce4f0;">
      <p style="color:${BRAND_MID_BLUE};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px;font-family:Arial,sans-serif;">${d.title}</p>
      <table width="100%" cellpadding="0" cellspacing="0">
        <thead>
          <tr style="background:${BRAND_BLUE};">
            <th style="padding:9px 0;text-align:left;color:#fff;font-size:12px;font-family:Arial,sans-serif;font-weight:600;">Descripción</th>
            <th style="padding:9px 0;text-align:center;color:#fff;font-size:12px;font-family:Arial,sans-serif;font-weight:600;">Cant.</th>
            <th style="padding:9px 0;text-align:right;color:#fff;font-size:12px;font-family:Arial,sans-serif;font-weight:600;">Precio</th>
            <th style="padding:9px 0;text-align:right;color:#fff;font-size:12px;font-family:Arial,sans-serif;font-weight:600;">Total</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
        ${Number(d.discount) > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">Descuento</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">-${Number(d.discount).toFixed(2)} €</td></tr>` : ""}
        ${Number(d.tax) > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">IVA</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">${Number(d.tax).toFixed(2)} €</td></tr>` : ""}
        <tr style="background:${BRAND_BLUE};"><td style="padding:10px 12px;color:#fff;font-size:15px;font-weight:700;font-family:Arial,sans-serif;">TOTAL</td><td style="padding:10px 12px;text-align:right;color:${BRAND_ORANGE};font-size:22px;font-weight:900;font-family:Georgia,serif;">${Number(d.total).toFixed(2)} €</td></tr>
      </table>
    </div>
  </td></tr>`;

  const validUntilBlock = d.validUntil
    ? `<tr><td style="padding:0 40px 8px;">
        <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;padding:12px 18px;">
          <p style="color:#92400e;font-size:13px;margin:0;font-family:Arial,sans-serif;">
            ⏳ Esta propuesta es válida hasta el <strong>${new Date(d.validUntil).toLocaleDateString("es-ES")}</strong>
          </p>
        </div>
      </td></tr>`
    : "";

  const notesBlock = d.notes
    ? `<tr><td style="padding:0 40px 8px;">
        <div style="background:#f8fafc;border-left:4px solid ${BRAND_ORANGE};border-radius:6px;padding:14px 18px;">
          <p style="color:#374151;font-size:14px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">${d.notes}</p>
        </div>
      </td></tr>`
    : "";

  const ctaBlock = d.paymentLinkUrl
    ? `<tr><td style="padding:8px 40px;">${ctaButton("Confirmar y Pagar Ahora", d.paymentLinkUrl)}<p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;font-family:Arial,sans-serif;">Pago 100% seguro · Redsys · SSL</p></td></tr>`
    : `<tr><td style="padding:8px 40px;">
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center;">
          <p style="color:#374151;font-size:14px;margin:0;font-family:Arial,sans-serif;">
            Para confirmar tu reserva, contacta con nosotros:<br/>
            <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};font-weight:700;text-decoration:none;">reservas@nayadeexperiences.es</a>
            &nbsp;·&nbsp;
            <a href="tel:+34930347791" style="color:${BRAND_ORANGE};font-weight:700;text-decoration:none;">+34 930 34 77 91</a>
          </p>
        </div>
      </td></tr>`;

  const conditionsBlock = d.conditions
    ? `<tr><td style="padding:0 40px 8px;">
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:20px;">
          <p style="color:${BRAND_MID_BLUE};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 10px;font-family:Arial,sans-serif;">Condiciones</p>
          <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;font-family:Arial,sans-serif;">${d.conditions}</p>
        </div>
      </td></tr>`
    : "";

  const body = `
    ${emailHeader("Tu Propuesta Personalizada", `Presupuesto <strong>${d.quoteNumber}</strong> preparado especialmente para ti`)}
    <tr><td style="padding:32px 40px 16px;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.clientName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 20px;line-height:1.7;font-family:Arial,sans-serif;">
        Hemos preparado tu propuesta personalizada con todos los detalles.
        Revísala con calma y no dudes en contactarnos si tienes alguna pregunta.
      </p>
    </td></tr>
    ${totalsBlock}
    ${validUntilBlock}
    ${notesBlock}
    ${ctaBlock}
    ${conditionsBlock}
    <tr><td style="padding:8px 40px 32px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        ¿Necesitas modificar algo? Escríbenos a
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">reservas@nayadeexperiences.es</a>
        o llámanos al <a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">+34 930 34 77 91</a>.
      </p>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper(`Presupuesto ${d.quoteNumber} — Náyade Experiences`, body);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 9: Confirmación de reserva desde CRM (pago confirmado por admin)
// ═══════════════════════════════════════════════════════════════════════════════
export interface ConfirmationEmailData {
  clientName: string;
  reservationRef: string;   // número de factura
  quoteNumber?: string;     // número de presupuesto original
  quoteTitle: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal?: string;
  taxAmount?: string;
  total: string;
  invoiceUrl?: string;
  bookingDate?: string;     // fecha del evento si aplica
  contactPhone?: string;
  contactEmail?: string;
}

export function buildConfirmationHtml(d: ConfirmationEmailData): string {
  const itemRowsHtml = d.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:11px 0;border-bottom:1px solid #e8eef7;color:#374151;font-size:14px;font-family:Arial,sans-serif;">${item.description}</td>
          <td style="padding:11px 0;border-bottom:1px solid #e8eef7;text-align:right;color:${BRAND_ORANGE};font-size:14px;font-weight:700;font-family:Arial,sans-serif;">${Number(item.total).toFixed(2)} €</td>
        </tr>`
    )
    .join("");

  const invoiceButtonBlock = d.invoiceUrl
    ? `<tr><td style="padding:8px 40px;text-align:center;">
        <a href="${d.invoiceUrl}"
           style="display:inline-block;background:#f0f4f8;color:${BRAND_BLUE};border:1px solid #dce4f0;font-size:14px;font-weight:600;padding:12px 28px;border-radius:50px;text-decoration:none;font-family:Arial,sans-serif;">
          📄 Descargar Factura
        </a>
      </td></tr>`
    : "";

  const subtotalRow = d.subtotal
    ? `<tr><td style="padding:6px 12px;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">Subtotal</td><td style="padding:6px 12px;text-align:right;color:#374151;font-size:13px;font-family:Arial,sans-serif;">${Number(d.subtotal).toFixed(2)} €</td></tr>`
    : "";
  const taxRow = d.taxAmount
    ? `<tr><td style="padding:6px 12px;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">IVA (21%)</td><td style="padding:6px 12px;text-align:right;color:#374151;font-size:13px;font-family:Arial,sans-serif;">${Number(d.taxAmount).toFixed(2)} €</td></tr>`
    : "";
  const bookingDateRow = d.bookingDate
    ? `<tr><td style="padding:8px 40px 0;"><div style="background:#fffbeb;border-left:4px solid ${BRAND_ORANGE};border-radius:6px;padding:12px 18px;"><p style="color:#374151;font-size:13px;margin:0;font-family:Arial,sans-serif;">📅 <strong>Fecha de la actividad:</strong> <span style="color:${BRAND_ORANGE};font-weight:700;">${d.bookingDate}</span></p></div></td></tr>`
    : "";
  const quoteRefRow = d.quoteNumber
    ? `<br/><span style="color:#9ca3af;font-size:12px;">Presupuesto original: <strong>${d.quoteNumber}</strong></span>`
    : "";
  const contactPhone = d.contactPhone ?? "+34 930 34 77 91";
  const contactEmail = d.contactEmail ?? "reservas@nayadeexperiences.es";

  const body = `
    ${emailHeader("Reserva Confirmada", "¡Tu aventura está lista!")}
    <tr><td style="padding:32px 40px 0;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.clientName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 20px;line-height:1.7;font-family:Arial,sans-serif;">
        Tu reserva ha sido <strong style="color:#166534;">confirmada</strong> y el pago procesado correctamente.
        ¡Te esperamos para vivir una experiencia única en el embalse de Los Ángeles de San Rafael!
      </p>
      ${statusBlock("success", "Pago procesado correctamente", "Tu plaza está reservada. Recibirás toda la información necesaria para el día de tu visita.")}
    </td></tr>
    ${bookingDateRow}
    <tr><td style="padding:8px 40px 8px;">
      <div style="background:linear-gradient(135deg,#f0f4f8,#e8eef7);border-radius:12px;padding:20px 24px;border:1px solid #dce4f0;">
        <p style="color:${BRAND_MID_BLUE};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px;font-family:Arial,sans-serif;">${d.quoteTitle}</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tbody>${itemRowsHtml}</tbody>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border-top:1px solid #dce4f0;">
          ${subtotalRow}
          ${taxRow}
          <tr style="background:${BRAND_BLUE};"><td style="padding:10px 12px;color:#fff;font-size:15px;font-weight:700;font-family:Arial,sans-serif;">Total pagado</td><td style="padding:10px 12px;text-align:right;color:${BRAND_ORANGE};font-size:22px;font-weight:900;font-family:Georgia,serif;">${Number(d.total).toFixed(2)} €</td></tr>
        </table>
      </div>
    </td></tr>
    <tr><td style="padding:8px 40px;">
      <div style="background:#f8fafc;border-left:4px solid ${BRAND_ORANGE};border-radius:6px;padding:14px 18px;">
        <p style="color:#374151;font-size:13px;margin:0;line-height:1.8;font-family:Arial,sans-serif;">
          ${SVG.ref}&nbsp;<strong>Referencia de factura:</strong> <span style="color:${BRAND_ORANGE};font-weight:700;">${d.reservationRef}</span>
          ${quoteRefRow}<br/>
          <span style="color:#9ca3af;font-size:12px;">Guarda este número para cualquier consulta.</span>
        </p>
      </div>
    </td></tr>
    ${invoiceButtonBlock}
    <tr><td style="padding:8px 40px 32px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        ¿Necesitas modificar tu reserva? Escríbenos a
        <a href="mailto:${contactEmail}" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">${contactEmail}</a>
        o llámanos al <a href="tel:${contactPhone.replace(/\s/g,"")}" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">${contactPhone}</a>.
      </p>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper(`Reserva Confirmada ${d.reservationRef} — Náyade Experiences`, body);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 10: HTML para PDF de presupuesto (descarga desde CRM)
// ═══════════════════════════════════════════════════════════════════════════════
export interface QuotePdfData {
  quoteNumber: string;
  title: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string | null;
  clientCompany?: string | null;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: string;
  discount: string | null;
  tax: string | null;
  total: string;
  validUntil?: Date | null;
  notes?: string | null;
  conditions?: string | null;
  paymentLinkUrl?: string | null;
  createdAt: Date;
}

export function buildQuotePdfHtml(d: QuotePdfData): string {
  const itemRowsHtml = d.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eef7;font-size:14px;color:#374151;">${item.description}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eef7;text-align:center;font-size:14px;color:#374151;">${item.quantity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eef7;text-align:right;font-size:14px;color:#374151;">${Number(item.unitPrice).toFixed(2)} €</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e8eef7;text-align:right;font-size:14px;font-weight:700;color:${BRAND_ORANGE};">${Number(item.total).toFixed(2)} €</td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  @page { margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; background: #eef2f7; color: #1e293b; }
</style>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:700px;margin:0 auto;background:#ffffff;min-height:100vh;box-shadow:0 8px 40px rgba(10,22,40,0.15);">
    <!-- Header gradient -->
    <div style="background:linear-gradient(135deg,${BRAND_BLUE} 0%,${BRAND_MID_BLUE} 60%,#1a4a8a 100%);padding:36px 40px 0;text-align:center;">
      <div style="display:inline-block;border-radius:50%;border:3px solid ${BRAND_ORANGE};padding:3px;margin-bottom:12px;">
        <img src="${LOGO_URL}" alt="Náyade" width="70" height="70" style="display:block;border-radius:50%;object-fit:cover;" />
      </div>
      <div style="color:#ffffff;font-size:26px;font-weight:900;letter-spacing:4px;font-family:Georgia,'Times New Roman',serif;">NÁYADE</div>
      <div style="color:rgba(255,255,255,0.55);font-size:10px;letter-spacing:6px;text-transform:uppercase;margin-top:3px;margin-bottom:16px;">EXPERIENCES</div>
      <div style="display:inline-block;background:${BRAND_ORANGE};color:#ffffff;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:5px 18px;border-radius:20px;margin-bottom:20px;">Presupuesto</div>
      <!-- Wave -->
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 40" preserveAspectRatio="none" width="700" height="40" style="display:block;margin-top:8px;">
        <path d="M0,20 C175,40 525,0 700,20 L700,40 L0,40 Z" fill="#ffffff"/>
      </svg>
    </div>

    <!-- Meta row -->
    <div style="padding:24px 40px 0;display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;margin-bottom:6px;font-family:Arial,sans-serif;">Cliente</div>
        <div style="font-size:17px;font-weight:700;color:${BRAND_BLUE};">${d.clientName}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:2px;">${d.clientEmail}${d.clientPhone ? " · " + d.clientPhone : ""}${d.clientCompany ? " · " + d.clientCompany : ""}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:22px;font-weight:800;color:${BRAND_ORANGE};">${d.quoteNumber}</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:4px;">Fecha: ${new Date(d.createdAt).toLocaleDateString("es-ES")}</div>
        ${d.validUntil ? `<div style="font-size:12px;color:#9ca3af;">Válido hasta: ${new Date(d.validUntil).toLocaleDateString("es-ES")}</div>` : ""}
      </div>
    </div>

    <!-- Items table -->
    <div style="padding:20px 40px;">
      <div style="background:linear-gradient(135deg,#f0f4f8,#e8eef7);border-radius:12px;padding:20px 24px;border:1px solid #dce4f0;">
        <p style="color:${BRAND_MID_BLUE};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 14px;font-family:Arial,sans-serif;">${d.title}</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <thead>
            <tr style="background:${BRAND_BLUE};">
              <th style="padding:10px 12px;text-align:left;color:#fff;font-size:12px;font-weight:600;">Descripción</th>
              <th style="padding:10px 12px;text-align:center;color:#fff;font-size:12px;font-weight:600;">Cant.</th>
              <th style="padding:10px 12px;text-align:right;color:#fff;font-size:12px;font-weight:600;">Precio unit.</th>
              <th style="padding:10px 12px;text-align:right;color:#fff;font-size:12px;font-weight:600;">Total</th>
            </tr>
          </thead>
          <tbody>${itemRowsHtml}</tbody>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
          ${Number(d.discount) > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Descuento</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:13px;">-${Number(d.discount).toFixed(2)} €</td></tr>` : ""}
          ${Number(d.tax) > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">IVA</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:13px;">${Number(d.tax).toFixed(2)} €</td></tr>` : ""}
          <tr style="background:${BRAND_BLUE};"><td style="padding:10px 12px;color:#fff;font-size:15px;font-weight:700;">TOTAL</td><td style="padding:10px 12px;text-align:right;color:${BRAND_ORANGE};font-size:22px;font-weight:900;font-family:Georgia,serif;">${Number(d.total).toFixed(2)} €</td></tr>
        </table>
      </div>
    </div>

    ${d.notes ? `<div style="padding:0 40px 16px;"><div style="background:#f8fafc;border-left:4px solid ${BRAND_ORANGE};border-radius:6px;padding:14px 18px;"><p style="color:#374151;font-size:14px;margin:0;line-height:1.6;">${d.notes}</p></div></div>` : ""}
    ${d.conditions ? `<div style="padding:0 40px 16px;"><div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:20px;"><p style="color:${BRAND_MID_BLUE};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 10px;">Condiciones</p><p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">${d.conditions}</p></div></div>` : ""}
    ${d.paymentLinkUrl ? `<div style="padding:0 40px 16px;text-align:center;"><div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:12px;padding:16px;"><p style="color:#374151;font-size:13px;margin:0 0 6px;">Enlace de pago:</p><p style="color:${BRAND_ORANGE};font-size:13px;font-weight:600;word-break:break-all;margin:0;">${d.paymentLinkUrl}</p></div></div>` : ""}

    <!-- Footer -->
    <div style="padding:0;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 30" preserveAspectRatio="none" width="700" height="30" style="display:block;">
        <path d="M0,15 C233,30 467,0 700,15 L700,0 L0,0 Z" fill="${BRAND_BLUE}"/>
      </svg>
      <div style="background:${BRAND_BLUE};padding:20px 40px;text-align:center;">
        <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 6px;line-height:1.8;">Los Ángeles de San Rafael, El Espinar, Segovia</p>
        <p style="color:rgba(255,255,255,0.5);font-size:12px;margin:0 0 6px;">
          <a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;">+34 930 34 77 91</a>
          &nbsp;&nbsp;
          <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;">reservas@nayadeexperiences.es</a>
        </p>
        <p style="color:rgba(255,255,255,0.25);font-size:10px;margin:8px 0 0;letter-spacing:1px;">© ${new Date().getFullYear()} NÁYADE EXPERIENCES · TODOS LOS DERECHOS RESERVADOS</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}
