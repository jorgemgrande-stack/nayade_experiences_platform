/**
 * emailTemplates.ts — Plantillas HTML premium de Náyade Experiences.
 *
 * DISEÑO v2.0 — Resort Aventura Premium
 * Estética: agua · naturaleza · emoción · ocio organizado · resort moderno · experiencia premium
 *
 * Estructura visual homogénea:
 *  1. Cabecera hero: imagen aérea del lago en full-width + overlay azul oscuro + logo centrado
 *  2. Tarjeta central flotante: fondo blanco, sombra suave, bordes redondeados
 *  3. Caja de estado: verde suave (confirmación), naranja (advertencia), rojo (error)
 *  4. Bloques de detalles: tabla clara con iconos lineales
 *  5. Botón CTA: naranja degradado energético, ancho, centrado
 *  6. Bloque emocional: texto inspiracional sobre experiencia
 *  7. Footer: fondo beige arena, datos contacto, claim de marca
 *
 * Compatibilidad: Outlook desktop, Gmail, Apple Mail, responsive híbrido
 * Ancho máximo: 600px · Layout: tablas HTML · CSS inline
 */

// ─── Constantes de marca ──────────────────────────────────────────────────────
const LOGO_URL    = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png";
const HERO_IMG    = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_lago_aereo_178815fc.jpg";
const BRAND_BLUE     = "#0a1628";
const BRAND_MID_BLUE = "#1e3a6e";
const BRAND_ORANGE   = "#f97316";
const BRAND_SAND     = "#f5f0e8";  // beige arena para footer
const BRAND_SAND_MID = "#ede8dc";

// ─── SVG icons inline (email-safe) ───────────────────────────────────────────
const SVG = {
  calendar: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  users:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  star:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="#f97316" stroke="#f97316" stroke-width="1" style="display:inline-block;vertical-align:middle;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  key:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>`,
  fork:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>`,
  clock:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  phone:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.81-.81a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.73 16a2 2 0 0 1 .27.92z"/></svg>`,
  mail:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  map:      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
  person:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  tag:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  chat:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  lock:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  check:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><polyline points="20 6 9 17 4 12"/></svg>`,
  alert:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  error:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  child:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><circle cx="12" cy="5" r="3"/><path d="M12 8v8"/><path d="M9 14l3 4 3-4"/></svg>`,
  ref:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
  wave:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><path d="M2 12c.5-2 2-3 4-3s3.5 1 5 3 2.5 3 5 3 3.5-1 4-3"/><path d="M2 6c.5-2 2-3 4-3s3.5 1 5 3 2.5 3 5 3 3.5-1 4-3"/><path d="M2 18c.5-2 2-3 4-3s3.5 1 5 3 2.5 3 5 3 3.5-1 4-3"/></svg>`,
};

// ─── COMPONENTE 1: Cabecera hero con imagen aérea del lago ────────────────────
// Estructura: imagen de fondo full-width + overlay azul oscuro + logo + titular
// Compatible con Outlook mediante VML background + tabla de contenido
function emailHeader(subtitle?: string, tagline?: string): string {
  return `
  <tr>
    <td style="padding:0;margin:0;">
      <!--[if gte mso 9]>
      <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:220px;">
        <v:fill type="tile" src="${HERO_IMG}" color="${BRAND_BLUE}" />
        <v:textbox inset="0,0,0,0">
      <![endif]-->
      <table width="600" cellpadding="0" cellspacing="0" border="0"
             style="background-color:${BRAND_BLUE};background-image:url('${HERO_IMG}');background-size:cover;background-position:center top;min-height:220px;">
        <tr>
          <td style="background:linear-gradient(180deg,rgba(10,22,40,0.72) 0%,rgba(10,22,40,0.88) 100%);padding:36px 40px 28px;text-align:center;">
            <!-- Logo circular con borde blanco semitransparente -->
            <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
              <div style="display:inline-block;border-radius:50%;border:3px solid rgba(255,255,255,0.8);padding:4px;background:rgba(255,255,255,0.12);">
                <img src="${LOGO_URL}" alt="Nayade" width="72" height="72"
                     style="display:block;border-radius:50%;object-fit:cover;border:0;" />
              </div>
            </td></tr></table>
            <!-- Nombre de marca -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr><td align="center">
              <div style="color:#ffffff;font-size:30px;font-weight:900;letter-spacing:5px;font-family:Georgia,'Times New Roman',serif;text-shadow:0 2px 12px rgba(0,0,0,0.5);">N&Aacute;YADE</div>
              <div style="color:rgba(255,255,255,0.65);font-size:10px;letter-spacing:7px;text-transform:uppercase;margin-top:2px;font-family:Arial,sans-serif;">EXPERIENCES</div>
            </td></tr></table>
            <!-- Badge de tipo de email -->
            ${subtitle ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr><td align="center"><div style="display:inline-block;background:${BRAND_ORANGE};color:#ffffff;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:6px 20px;border-radius:20px;font-family:Arial,sans-serif;">${subtitle}</div></td></tr></table>` : ""}
            <!-- Tagline emocional -->
            ${tagline ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr><td align="center"><div style="color:rgba(255,255,255,0.80);font-size:13px;font-family:Arial,sans-serif;line-height:1.5;font-style:italic;">${tagline}</div></td></tr></table>` : ""}
          </td>
        </tr>
      </table>
      <!--[if gte mso 9]>
        </v:textbox>
      </v:rect>
      <![endif]-->
      <!-- Ola decorativa inferior (blanca) -->
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_BLUE};"><tr>
        <td style="line-height:0;padding:0;font-size:0;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 32" preserveAspectRatio="none" width="600" height="32" style="display:block;">
            <path d="M0,16 C100,32 200,0 300,16 C400,32 500,0 600,16 L600,32 L0,32 Z" fill="#ffffff"/>
          </svg>
        </td>
      </tr></table>
    </td>
  </tr>`;
}

// ─── COMPONENTE 7: Footer beige arena con claim de marca ──────────────────────
function emailFooter(): string {
  return `
  <tr>
    <td style="padding:0;">
      <!-- Ola decorativa superior (beige) -->
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;"><tr>
        <td style="line-height:0;padding:0;font-size:0;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 24" preserveAspectRatio="none" width="600" height="24" style="display:block;">
            <path d="M0,12 C100,24 200,0 300,12 C400,24 500,0 600,12 L600,24 L0,24 Z" fill="${BRAND_SAND}"/>
          </svg>
        </td>
      </tr></table>
      <!-- Bloque footer beige arena -->
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND_SAND};"><tr>
        <td style="padding:24px 40px 20px;text-align:center;">
          <!-- Línea divisoria decorativa -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr>
            <td style="border-top:1px solid ${BRAND_SAND_MID};font-size:0;line-height:0;">&nbsp;</td>
          </tr></table>
          <!-- Datos de contacto -->
          <p style="color:#6b5c3e;font-size:13px;margin:0 0 6px;font-family:Arial,sans-serif;line-height:1.8;">
            ${SVG.phone}&nbsp;<a href="tel:+34930347791" style="color:#8b6914;text-decoration:none;font-weight:600;">+34 930 34 77 91</a>
            &nbsp;&nbsp;&nbsp;${SVG.mail}&nbsp;<a href="mailto:reservas@nayadeexperiences.es" style="color:#8b6914;text-decoration:none;font-weight:600;">reservas@nayadeexperiences.es</a>
          </p>
          <p style="color:#8b7355;font-size:12px;margin:0 0 12px;font-family:Arial,sans-serif;">
            ${SVG.map}&nbsp;Los &Aacute;ngeles de San Rafael &middot; El Espinar &middot; Segovia
          </p>
          <!-- Línea divisoria -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;"><tr>
            <td style="border-top:1px solid ${BRAND_SAND_MID};font-size:0;line-height:0;">&nbsp;</td>
          </tr></table>
          <!-- Claim de marca -->
          <p style="color:#a08060;font-size:12px;margin:0 0 4px;font-family:Georgia,'Times New Roman',serif;font-style:italic;letter-spacing:0.5px;">
            N&aacute;yade Experiences &mdash; Vive el verano todo el a&ntilde;o
          </p>
          <p style="color:#c4a882;font-size:10px;margin:0;font-family:Arial,sans-serif;letter-spacing:1px;">
            &copy; ${new Date().getFullYear()} N&Aacute;YADE EXPERIENCES &middot; TODOS LOS DERECHOS RESERVADOS
          </p>
        </td>
      </tr></table>
    </td>
  </tr>`;
}

// ─── COMPONENTE: Wrapper HTML completo ───────────────────────────────────────
function emailWrapper(title: string, bodyRows: string): string {
  return `<!DOCTYPE html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#e8edf5;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#e8edf5;padding:32px 0;">
    <tr><td align="center" style="padding:0;">
      <!--[if (gte mso 9)|(IE)]>
      <table width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td>
      <![endif]-->
      <table width="600" cellpadding="0" cellspacing="0" border="0"
             style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;box-shadow:0 4px 24px rgba(10,22,40,0.12);">
        ${bodyRows}
      </table>
      <!--[if (gte mso 9)|(IE)]>
      </td></tr></table>
      <![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── COMPONENTE: Fila de detalle con icono ────────────────────────────────────
function detailRow(icon: string, label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #eef2f7;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="26" style="vertical-align:middle;">${icon}</td>
        <td style="color:#6b7280;font-size:13px;vertical-align:middle;font-family:Arial,sans-serif;">${label}</td>
        <td align="right" style="color:${BRAND_BLUE};font-size:13px;font-weight:700;vertical-align:middle;font-family:Arial,sans-serif;">${value}</td>
      </tr></table>
    </td>
  </tr>`;
}

// ─── COMPONENTE 3: Caja de estado ─────────────────────────────────────────────
function statusBlock(type: "success" | "warning" | "error", title: string, body: string): string {
  const cfg = {
    success: { bg: "#f0fdf4", border: "#22c55e", icon: SVG.check,  titleColor: "#166534", bodyColor: "#15803d" },
    warning: { bg: "#fffbeb", border: "#f59e0b", icon: SVG.alert,  titleColor: "#92400e", bodyColor: "#b45309" },
    error:   { bg: "#fef2f2", border: "#ef4444", icon: SVG.error,  titleColor: "#991b1b", bodyColor: "#b91c1c" },
  };
  const c = cfg[type];
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
    <tr><td style="background:${c.bg};border-left:4px solid ${c.border};border-radius:0 8px 8px 0;padding:14px 18px;">
      <p style="margin:0 0 5px;color:${c.titleColor};font-weight:700;font-size:14px;font-family:Arial,sans-serif;">${c.icon}&nbsp;${title}</p>
      <p style="margin:0;color:${c.bodyColor};font-size:13px;line-height:1.6;font-family:Arial,sans-serif;">${body}</p>
    </td></tr>
  </table>`;
}

// ─── COMPONENTE 5: Botón CTA naranja degradado ────────────────────────────────
// Estructura segura para email: tabla con celda coloreada (compatible Outlook)
function ctaButton(text: string, href: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
    <tr><td align="center">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
        href="${href}" style="height:54px;v-text-anchor:middle;width:320px;" arcsize="8%" stroke="f" fillcolor="#E85D04">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:17px;font-weight:bold;letter-spacing:1px;">${text}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${href}"
         style="display:inline-block;background:linear-gradient(135deg,#f97316 0%,#E85D04 50%,#c94d00 100%);color:#ffffff;font-size:17px;font-weight:900;padding:16px 48px;border-radius:8px;text-decoration:none;letter-spacing:1px;font-family:Arial,Helvetica,sans-serif;border:0;mso-hide:all;">
        ${text}
      </a>
      <!--<![endif]-->
    </td></tr>
  </table>`;
}

// ─── COMPONENTE 4: Bloque de detalles con fondo ───────────────────────────────
function detailsCard(rows: string, cardTitle?: string): string {
  return `<tr><td style="padding:0 32px 12px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e8eef7;">
      <tr><td style="padding:18px 22px;">
        <p style="color:${BRAND_MID_BLUE};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;font-family:Arial,sans-serif;">
          ${cardTitle ?? "DETALLES DE TU EXPERIENCIA"}
        </p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>
    </table>
  </td></tr>`;
}

// ─── COMPONENTE 6: Bloque emocional (texto inspiracional) ─────────────────────
function emotionalBlock(text: string): string {
  return `<tr><td style="padding:0 32px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,${BRAND_BLUE},${BRAND_MID_BLUE});border-radius:10px;">
      <tr><td style="padding:20px 24px;text-align:center;">
        <p style="color:rgba(255,255,255,0.9);font-size:14px;font-family:Georgia,'Times New Roman',serif;font-style:italic;line-height:1.7;margin:0;">${text}</p>
      </td></tr>
    </table>
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
    ${emailHeader("Reserva Confirmada", "Tu experiencia perfecta empieza aqu&iacute;")}
    <tr><td style="padding:28px 32px 0;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.customerName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 16px;line-height:1.7;font-family:Arial,sans-serif;">
        Tu reserva ha sido <strong style="color:#166534;">confirmada</strong> y el pago procesado correctamente.
        &#161;Te esperamos para vivir una experiencia &uacute;nica en el embalse de Los &Aacute;ngeles de San Rafael!
      </p>
      ${statusBlock("success", "Pago procesado correctamente", "Tu plaza est&aacute; reservada. Recibir&aacute;s toda la informaci&oacute;n necesaria para el d&iacute;a de tu visita.")}
    </td></tr>
    ${detailsCard(`
      ${detailRow(SVG.star,     "Experiencia",  d.productName)}
      ${detailRow(SVG.calendar, "Fecha",        d.date)}
      ${detailRow(SVG.users,    "Personas",     `${d.people} persona${d.people !== 1 ? "s" : ""}`)}
      ${d.extras && d.extras !== "Ninguno" ? detailRow(SVG.tag, "Extras", d.extras) : ""}
    `)}
    <tr><td style="padding:0 32px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,${BRAND_BLUE},${BRAND_MID_BLUE});border-radius:10px;">
        <tr>
          <td style="padding:14px 20px;color:rgba(255,255,255,0.7);font-size:13px;font-family:Arial,sans-serif;">Total pagado</td>
          <td align="right" style="padding:14px 20px;color:#ffffff;font-size:26px;font-weight:900;font-family:Georgia,serif;">${d.amount}</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 32px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border-left:4px solid ${BRAND_ORANGE};border-radius:0 8px 8px 0;">
        <tr><td style="padding:14px 18px;">
          <p style="color:#374151;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
            ${SVG.ref}&nbsp;<strong>Referencia de reserva:</strong> <span style="color:${BRAND_ORANGE};font-weight:700;">${d.merchantOrder}</span><br/>
            <span style="color:#9ca3af;font-size:12px;">Guarda este n&uacute;mero para cualquier consulta.</span>
          </p>
        </td></tr>
      </table>
    </td></tr>
    ${emotionalBlock("El agua, la naturaleza y la emoci&oacute;n te esperan. &#161;Nos vemos pronto!")}
    <tr><td style="padding:0 32px 28px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        &iquest;Necesitas modificar tu reserva? Escrb&iacute;benos a
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">reservas@nayadeexperiences.es</a>
        o ll&aacute;manos al <a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">+34 930 34 77 91</a>.
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
    <tr><td style="padding:28px 32px 24px;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.customerName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 16px;line-height:1.7;font-family:Arial,sans-serif;">
        Lamentablemente no hemos podido procesar el pago de tu reserva para
        <strong>${d.productName}</strong>. Esto puede deberse a un problema temporal con tu banco.
      </p>
      ${statusBlock("error", "Pago no procesado", `Referencia: <strong>${d.merchantOrder}</strong> &middot; C&oacute;digo: ${d.responseCode}`)}
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
    ? statusBlock("warning", "Dep&oacute;sito pendiente",
        `Tu reserva est&aacute; registrada pero necesita el pago del dep&oacute;sito (<strong>${d.depositAmount} &euro;</strong>) para quedar confirmada. Recibir&aacute;s el enlace de pago en breve.`)
    : statusBlock("success", "Reserva confirmada",
        "&#161;Tu mesa est&aacute; reservada! Te esperamos para disfrutar de la mejor gastronom&iacute;a junto al lago.");

  const body = `
    ${emailHeader(`Mesa en ${d.restaurantName}`, "Gastronom&iacute;a junto al lago")}
    <tr><td style="padding:28px 32px 0;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.guestName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 16px;line-height:1.7;font-family:Arial,sans-serif;">
        Hemos recibido tu solicitud de reserva en <strong>${d.restaurantName}</strong>. Aqu&iacute; tienes el resumen:
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
    ${emotionalBlock("Una mesa con vistas al lago, la mejor gastronom&iacute;a y momentos inolvidables te esperan.")}
    <tr><td style="padding:0 32px 28px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        &iquest;Necesitas modificar tu reserva? Escrb&iacute;benos a
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">reservas@nayadeexperiences.es</a>
        o ll&aacute;manos al <a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">+34 930 34 77 91</a>.
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
    ${emailHeader("Confirma tu Reserva", `Dep&oacute;sito de ${d.depositAmount} &euro; pendiente`)}
    <tr><td style="padding:28px 32px 0;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.guestName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 16px;line-height:1.7;font-family:Arial,sans-serif;">
        Tu reserva en <strong>${d.restaurantName}</strong> est&aacute; casi lista.
        Para confirmarla, abona el dep&oacute;sito de <strong style="color:${BRAND_ORANGE};font-size:17px;">${d.depositAmount} &euro;</strong>.
      </p>
    </td></tr>
    ${detailsCard(`
      ${detailRow(SVG.fork,     "Restaurante",  d.restaurantName)}
      ${detailRow(SVG.calendar, "Fecha",        d.date)}
      ${detailRow(SVG.clock,    "Hora",         d.time)}
      ${detailRow(SVG.users,    "Comensales",   `${d.guests} persona${d.guests !== 1 ? "s" : ""}`)}
      ${detailRow(SVG.key,      "Localizador",  `<span style="font-size:17px;color:${BRAND_ORANGE};font-weight:900;">${d.locator}</span>`)}
    `)}
    <tr><td style="padding:8px 32px 28px;text-align:center;">
      <p style="color:#374151;font-size:14px;margin:0 0 16px;font-family:Arial,sans-serif;">Haz clic para pagar el dep&oacute;sito de forma segura:</p>
      <form method="POST" action="${d.redsysUrl}" style="display:inline;">
        <input type="hidden" name="Ds_SignatureVersion" value="${d.signatureVersion}" />
        <input type="hidden" name="Ds_MerchantParameters" value="${d.merchantParams}" />
        <input type="hidden" name="Ds_Signature" value="${d.signature}" />
        <button type="submit"
          style="display:inline-block;background:linear-gradient(135deg,#f97316 0%,#E85D04 50%,#c94d00 100%);color:#ffffff;border:none;padding:16px 44px;border-radius:8px;font-size:16px;font-weight:900;cursor:pointer;letter-spacing:0.5px;font-family:Arial,sans-serif;">
          Pagar ${d.depositAmount} &euro; &rarr;
        </button>
      </form>
      <p style="color:#9ca3af;font-size:12px;margin:14px 0 0;font-family:Arial,sans-serif;">
        Pago seguro procesado por Redsys. Tu reserva quedar&aacute; confirmada autom&aacute;ticamente.
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
    ${emailHeader("Bienvenido al Equipo", "Plataforma de Gesti&oacute;n N&aacute;yade")}
    <tr><td style="padding:28px 32px 0;">
      <h2 style="color:${BRAND_BLUE};font-size:22px;margin:0 0 12px;font-weight:700;font-family:Georgia,serif;">&#161;Hola ${d.name}!</h2>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 16px;font-family:Arial,sans-serif;">
        Se ha creado una cuenta para ti en la plataforma de gesti&oacute;n de <strong>N&aacute;yade Experiences</strong>
        con el rol de:
      </p>
      <table cellpadding="0" cellspacing="0" style="margin-bottom:20px;"><tr>
        <td style="background:linear-gradient(135deg,${BRAND_BLUE},${BRAND_MID_BLUE});color:#ffffff;padding:8px 22px;border-radius:20px;font-size:13px;font-weight:700;letter-spacing:1px;font-family:Arial,sans-serif;">
          ${roleLabel}
        </td>
      </tr></table>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;font-family:Arial,sans-serif;">
        Para activar tu cuenta y establecer tu contrase&ntilde;a, haz clic en el bot&oacute;n de abajo.
        Este enlace es v&aacute;lido durante <strong>72 horas</strong>.
      </p>
      ${ctaButton("Activar mi cuenta", d.setPasswordUrl)}
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr><td style="background:#f8fafc;border-left:4px solid ${BRAND_BLUE};border-radius:0 8px 8px 0;padding:14px 18px;">
          <p style="color:#374151;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
            Si el bot&oacute;n no funciona, copia y pega este enlace en tu navegador:<br/>
            <a href="${d.setPasswordUrl}" style="color:${BRAND_ORANGE};word-break:break-all;font-size:12px;">${d.setPasswordUrl}</a>
          </p>
        </td></tr>
      </table>
      <p style="color:#9ca3af;font-size:13px;line-height:1.6;margin:0 0 28px;font-family:Arial,sans-serif;">
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
    ${emailHeader("Recuperar Contrase&ntilde;a")}
    <tr><td style="padding:28px 32px 0;">
      <h2 style="color:${BRAND_BLUE};font-size:20px;margin:0 0 12px;font-weight:700;font-family:Georgia,serif;">Restablecer contrase&ntilde;a</h2>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 12px;font-family:Arial,sans-serif;">Hola <strong>${d.name}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 8px;font-family:Arial,sans-serif;">
        Hemos recibido una solicitud para restablecer la contrase&ntilde;a de tu cuenta.
        Haz clic en el bot&oacute;n de abajo para crear una nueva contrase&ntilde;a:
      </p>
      ${ctaButton("Restablecer contrase&ntilde;a", d.resetUrl)}
      ${statusBlock("warning", "Enlace temporal",
        `Este enlace caduca en <strong>${d.expiryMinutes} minutos</strong>. Si no solicitaste este cambio, puedes ignorar este mensaje.`)}
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
        <tr><td style="background:#f8fafc;border-left:4px solid ${BRAND_BLUE};border-radius:0 8px 8px 0;padding:14px 18px;">
          <p style="color:#374151;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
            Si el bot&oacute;n no funciona, copia y pega este enlace en tu navegador:<br/>
            <a href="${d.resetUrl}" style="color:${BRAND_ORANGE};word-break:break-all;font-size:12px;">${d.resetUrl}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper("Recuperar contraseña — Náyade Experiences", body);
}

export interface ActivityEmailEntry {
  experienceTitle: string;
  participants: number;
  details: Record<string, string | number>;
}

// ─── Helper: bloque de actividades enriquecidas ─────────────────────────────
function buildActivitiesBlock(activities: ActivityEmailEntry[]): string {
  const labelMap: Record<string, string> = {
    duration: 'Duraci\u00f3n', jumps: 'Saltos', level: 'Nivel', type: 'Tipo', notes: 'Notas'
  };
  const rows = activities.map((act) => {
    const detailChips = Object.entries(act.details || {})
      .map(([k, v]) => `<span style="display:inline-block;background:#dbeafe;color:#1e40af;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;margin:2px 3px 2px 0;font-family:Arial,sans-serif;">${labelMap[k] ?? k}: ${String(v)}</span>`)
      .join('');
    return `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #eef2f7;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="color:${BRAND_BLUE};font-size:13px;font-weight:700;font-family:Arial,sans-serif;">
              ${SVG.star}&nbsp;${act.experienceTitle}
            </td>
            <td align="right" style="color:${BRAND_ORANGE};font-size:13px;font-weight:700;font-family:Arial,sans-serif;white-space:nowrap;">
              ${act.participants} pax
            </td>
          </tr></table>
          ${detailChips ? `<div style="margin-top:5px;">${detailChips}</div>` : ''}
        </td>
      </tr>`;
  }).join('');
  return `<tr><td style="padding:0 32px 12px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border-radius:10px;border:1px solid #bfdbfe;">
      <tr><td style="padding:18px 22px;">
        <p style="color:#1e40af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;font-family:Arial,sans-serif;">Actividades solicitadas</p>
        <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>
    </table>
  </td></tr>`;
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
  activitiesJson?: ActivityEmailEntry[];
}

export function buildBudgetRequestUserHtml(d: BudgetRequestEmailData): string {
  const body = `
    ${emailHeader("Solicitud Recibida", "Tu experiencia perfecta empieza aqu&iacute;")}
    <tr><td style="padding:28px 32px 0;">
      <h2 style="color:${BRAND_BLUE};font-size:22px;margin:0 0 12px;font-weight:700;font-family:Georgia,serif;">&#161;Hola ${d.name}!</h2>
      <p style="color:#6b7280;font-size:15px;line-height:1.7;margin:0 0 16px;font-family:Arial,sans-serif;">
        Hemos recibido tu solicitud de presupuesto y ya estamos preparando una propuesta personalizada
        para que vivas una jornada inolvidable en N&aacute;yade Experiences.
      </p>
      ${statusBlock("success", "Solicitud recibida correctamente",
        "Te contactaremos en menos de 24 horas.")}
    </td></tr>
    ${detailsCard(`
      ${detailRow(SVG.calendar, "Fecha prevista",          d.arrivalDate)}
      ${detailRow(SVG.users,    "Adultos",                 String(d.adults))}
      ${detailRow(SVG.child,    "Ni&ntilde;os",            String(d.children))}
      ${detailRow(SVG.tag,      "Categor&iacute;a",        d.selectedCategory)}
      ${!d.activitiesJson?.length ? detailRow(SVG.star, "Experiencia solicitada", d.selectedProduct) : ""}
      ${d.comments ? detailRow(SVG.chat, "Comentarios", d.comments) : ""}
      ${detailRow(SVG.phone,    "Tel&eacute;fono de contacto", d.phone)}
    `)}
    ${d.activitiesJson?.length ? buildActivitiesBlock(d.activitiesJson) : ""}
    ${emotionalBlock("El agua, la naturaleza y la emoci&oacute;n te esperan. &#161;Nos vemos pronto en el lago!")}
    <tr><td style="padding:0 32px 28px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        &iquest;Necesitas modificar alg&uacute;n dato? Escrb&iacute;benos a
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">reservas@nayadeexperiences.es</a>
        o ll&aacute;manos al <a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">+34 930 34 77 91</a>.
      </p>
    </td></tr>
    ${emailFooter()}`;
  return emailWrapper("Solicitud de presupuesto recibida — Náyade Experiences", body);
}

export function buildBudgetRequestAdminHtml(d: BudgetRequestEmailData): string {
  const body = `
    ${emailHeader("Nueva Solicitud", "Acci&oacute;n requerida en menos de 24h")}
    <tr><td style="padding:28px 32px 0;">
      <h2 style="color:${BRAND_BLUE};font-size:20px;margin:0 0 12px;font-weight:700;font-family:Georgia,serif;">Nueva solicitud de presupuesto</h2>
      ${statusBlock("warning", "Acci&oacute;n requerida",
        "Se ha recibido una nueva solicitud de presupuesto. Contacta al cliente en menos de 24 horas.")}
    </td></tr>
    ${detailsCard(`
      ${detailRow(SVG.person,   "Nombre",                  d.name)}
      ${detailRow(SVG.mail,     "Email",                   d.email)}
      ${detailRow(SVG.phone,    "Tel&eacute;fono",         d.phone)}
      ${detailRow(SVG.calendar, "D&iacute;a de llegada",   d.arrivalDate)}
      ${detailRow(SVG.users,    "Adultos",                 String(d.adults))}
      ${detailRow(SVG.child,    "Ni&ntilde;os",            String(d.children))}
      ${detailRow(SVG.tag,      "Categor&iacute;a",        d.selectedCategory)}
      ${!d.activitiesJson?.length ? detailRow(SVG.star, "Experiencia solicitada", d.selectedProduct) : ""}
      ${d.comments ? detailRow(SVG.chat, "Comentarios", d.comments) : ""}
      ${detailRow(SVG.clock,    "Fecha de env&iacute;o",   d.submittedAt)}
    `)}
    ${d.activitiesJson?.length ? buildActivitiesBlock(d.activitiesJson) : ""}
    <tr><td style="padding:0 32px 28px;">
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
          <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#374151;font-size:13px;font-family:Arial,sans-serif;">${item.description}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:center;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">${item.quantity}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">${Number(item.unitPrice).toFixed(2)} &euro;</td>
          <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;color:${BRAND_ORANGE};font-size:13px;font-weight:700;font-family:Arial,sans-serif;">${Number(item.total).toFixed(2)} &euro;</td>
        </tr>`
    )
    .join("");

  const totalsBlock = `<tr><td style="padding:0 32px 12px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e8eef7;">
      <tr><td style="padding:18px 22px;">
        <p style="color:${BRAND_MID_BLUE};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;font-family:Arial,sans-serif;">${d.title}</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <thead>
            <tr style="background:${BRAND_BLUE};">
              <th style="padding:9px 8px;text-align:left;color:#fff;font-size:11px;font-family:Arial,sans-serif;font-weight:600;">Descripci&oacute;n</th>
              <th style="padding:9px 8px;text-align:center;color:#fff;font-size:11px;font-family:Arial,sans-serif;font-weight:600;">Cant.</th>
              <th style="padding:9px 8px;text-align:right;color:#fff;font-size:11px;font-family:Arial,sans-serif;font-weight:600;">Precio</th>
              <th style="padding:9px 8px;text-align:right;color:#fff;font-size:11px;font-family:Arial,sans-serif;font-weight:600;">Total</th>
            </tr>
          </thead>
          <tbody>${itemRowsHtml}</tbody>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
          ${Number(d.discount) > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">Descuento</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">-${Number(d.discount).toFixed(2)} &euro;</td></tr>` : ""}
          ${Number(d.tax) > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">IVA</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">${Number(d.tax).toFixed(2)} &euro;</td></tr>` : ""}
          <tr style="background:${BRAND_BLUE};"><td style="padding:10px 12px;color:#fff;font-size:14px;font-weight:700;font-family:Arial,sans-serif;">TOTAL</td><td style="padding:10px 12px;text-align:right;color:${BRAND_ORANGE};font-size:22px;font-weight:900;font-family:Georgia,serif;">${Number(d.total).toFixed(2)} &euro;</td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>`;

  const validUntilBlock = d.validUntil
    ? `<tr><td style="padding:0 32px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0 8px 8px 0;">
          <tr><td style="padding:12px 18px;">
            <p style="color:#92400e;font-size:13px;margin:0;font-family:Arial,sans-serif;">
              &#9203; Esta propuesta es v&aacute;lida hasta el <strong>${new Date(d.validUntil).toLocaleDateString("es-ES")}</strong>
            </p>
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const notesBlock = d.notes
    ? `<tr><td style="padding:0 32px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border-left:4px solid ${BRAND_ORANGE};border-radius:0 8px 8px 0;">
          <tr><td style="padding:14px 18px;">
            <p style="color:#374151;font-size:14px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">${d.notes}</p>
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const ctaBlock = d.paymentLinkUrl
    ? `<tr><td style="padding:0 32px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:2px solid #fed7aa;border-radius:10px;">
          <tr><td style="padding:24px;text-align:center;">
            <p style="color:#9a3412;font-size:14px;font-weight:700;margin:0 0 6px;font-family:Arial,sans-serif;">&#128274; Tu reserva est&aacute; a un clic</p>
            <p style="color:#c2410c;font-size:13px;margin:0 0 16px;font-family:Arial,sans-serif;">Haz clic en el bot&oacute;n para confirmar y pagar de forma segura</p>
            ${ctaButton("Confirmar y Pagar Ahora", d.paymentLinkUrl)}
            <p style="color:#9ca3af;font-size:12px;margin:0;font-family:Arial,sans-serif;">&#128274; Pago 100% seguro &middot; Redsys &middot; SSL</p>
          </td></tr>
        </table>
      </td></tr>`
    : `<tr><td style="padding:0 32px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
          <tr><td style="padding:18px;text-align:center;">
            <p style="color:#374151;font-size:14px;margin:0;font-family:Arial,sans-serif;">
              Para confirmar tu reserva, contacta con nosotros:<br/>
              <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};font-weight:700;text-decoration:none;">reservas@nayadeexperiences.es</a>
              &nbsp;&middot;&nbsp;
              <a href="tel:+34930347791" style="color:${BRAND_ORANGE};font-weight:700;text-decoration:none;">+34 930 34 77 91</a>
            </p>
          </td></tr>
        </table>
      </td></tr>`;

  const conditionsBlock = d.conditions
    ? `<tr><td style="padding:0 32px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;">
          <tr><td style="padding:18px 22px;">
            <p style="color:${BRAND_MID_BLUE};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 10px;font-family:Arial,sans-serif;">Condiciones</p>
            <p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;font-family:Arial,sans-serif;">${d.conditions}</p>
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const body = `
    ${emailHeader("Tu Propuesta Personalizada", `Presupuesto <strong>${d.quoteNumber}</strong> preparado especialmente para ti`)}
    <tr><td style="padding:28px 32px 16px;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.clientName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 16px;line-height:1.7;font-family:Arial,sans-serif;">
        Hemos preparado tu propuesta personalizada con todos los detalles.
        Rev&iacute;sala con calma y no dudes en contactarnos si tienes alguna pregunta.
      </p>
    </td></tr>
    ${totalsBlock}
    ${validUntilBlock}
    ${notesBlock}
    ${ctaBlock}
    ${conditionsBlock}
    ${emotionalBlock("Una experiencia &uacute;nica te espera en el lago. &#161;Conf&iacute;a en nosotros para hacerla inolvidable!")}
    <tr><td style="padding:0 32px 28px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        &iquest;Necesitas modificar algo? Escrb&iacute;benos a
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">reservas@nayadeexperiences.es</a>
        o ll&aacute;manos al <a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">+34 930 34 77 91</a>.
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
          <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#374151;font-size:13px;font-family:Arial,sans-serif;">${item.description}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;color:${BRAND_ORANGE};font-size:13px;font-weight:700;font-family:Arial,sans-serif;">${Number(item.total).toFixed(2)} &euro;</td>
        </tr>`
    )
    .join("");

  const invoiceButtonBlock = d.invoiceUrl
    ? `<tr><td style="padding:0 32px 12px;text-align:center;">
        <a href="${d.invoiceUrl}"
           style="display:inline-block;background:#f0f4f8;color:${BRAND_BLUE};border:1px solid #dce4f0;font-size:14px;font-weight:600;padding:12px 28px;border-radius:50px;text-decoration:none;font-family:Arial,sans-serif;">
          &#128196; Descargar Factura
        </a>
      </td></tr>`
    : "";

  const subtotalRow = d.subtotal
    ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">Subtotal</td><td style="padding:6px 0;text-align:right;color:#374151;font-size:13px;font-family:Arial,sans-serif;">${Number(d.subtotal).toFixed(2)} &euro;</td></tr>`
    : "";
  const taxRow = d.taxAmount
    ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">IVA (21%)</td><td style="padding:6px 0;text-align:right;color:#374151;font-size:13px;font-family:Arial,sans-serif;">${Number(d.taxAmount).toFixed(2)} &euro;</td></tr>`
    : "";
  const bookingDateRow = d.bookingDate
    ? `<tr><td style="padding:0 32px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border-left:4px solid ${BRAND_ORANGE};border-radius:0 8px 8px 0;">
          <tr><td style="padding:12px 18px;">
            <p style="color:#374151;font-size:13px;margin:0;font-family:Arial,sans-serif;">&#128197; <strong>Fecha de la actividad:</strong> <span style="color:${BRAND_ORANGE};font-weight:700;">${d.bookingDate}</span></p>
          </td></tr>
        </table>
      </td></tr>`
    : "";
  const quoteRefRow = d.quoteNumber
    ? `<br/><span style="color:#9ca3af;font-size:12px;">Presupuesto original: <strong>${d.quoteNumber}</strong></span>`
    : "";
  const contactPhone = d.contactPhone ?? "+34 930 34 77 91";
  const contactEmail = d.contactEmail ?? "reservas@nayadeexperiences.es";

  const body = `
    ${emailHeader("Reserva Confirmada", "Tu experiencia perfecta empieza aqu&iacute;")}
    <tr><td style="padding:28px 32px 0;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.clientName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 16px;line-height:1.7;font-family:Arial,sans-serif;">
        Tu reserva ha sido <strong style="color:#166534;">confirmada</strong> y el pago procesado correctamente.
        &#161;Te esperamos para vivir una experiencia &uacute;nica en el embalse de Los &Aacute;ngeles de San Rafael!
      </p>
      ${statusBlock("success", "Pago procesado correctamente", "Tu plaza est&aacute; reservada. Recibir&aacute;s toda la informaci&oacute;n necesaria para el d&iacute;a de tu visita.")}
    </td></tr>
    ${bookingDateRow}
    <tr><td style="padding:0 32px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e8eef7;">
        <tr><td style="padding:18px 22px;">
          <p style="color:${BRAND_MID_BLUE};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;font-family:Arial,sans-serif;">${d.quoteTitle}</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tbody>${itemRowsHtml}</tbody>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid #e8eef7;">
            ${subtotalRow}
            ${taxRow}
            <tr style="background:${BRAND_BLUE};"><td style="padding:10px 12px;color:#fff;font-size:14px;font-weight:700;font-family:Arial,sans-serif;">Total pagado</td><td style="padding:10px 12px;text-align:right;color:${BRAND_ORANGE};font-size:22px;font-weight:900;font-family:Georgia,serif;">${Number(d.total).toFixed(2)} &euro;</td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 32px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border-left:4px solid ${BRAND_ORANGE};border-radius:0 8px 8px 0;">
        <tr><td style="padding:14px 18px;">
          <p style="color:#374151;font-size:13px;margin:0;line-height:1.8;font-family:Arial,sans-serif;">
            ${SVG.ref}&nbsp;<strong>Referencia de factura:</strong> <span style="color:${BRAND_ORANGE};font-weight:700;">${d.reservationRef}</span>
            ${quoteRefRow}<br/>
            <span style="color:#9ca3af;font-size:12px;">Guarda este n&uacute;mero para cualquier consulta.</span>
          </p>
        </td></tr>
      </table>
    </td></tr>
    ${invoiceButtonBlock}
    ${emotionalBlock("El agua, la naturaleza y la emoci&oacute;n te esperan. &#161;Nos vemos pronto en el lago!")}
    <tr><td style="padding:0 32px 28px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        &iquest;Necesitas modificar tu reserva? Escrb&iacute;benos a
        <a href="mailto:${contactEmail}" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">${contactEmail}</a>
        o ll&aacute;manos al <a href="tel:${contactPhone.replace(/\s/g,"")}" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">${contactPhone}</a>.
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
  // Datos de empresa facturadora (opcionales para compatibilidad)
  issuerName?: string;
  issuerCif?: string;
  issuerAddress?: string;
}

export function buildQuotePdfHtml(d: QuotePdfData): string {
  const itemRowsHtml = d.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eef2f7;font-size:13px;color:#374151;">${item.description}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef2f7;text-align:center;font-size:13px;color:#374151;">${item.quantity}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef2f7;text-align:right;font-size:13px;color:#374151;">${Number(item.unitPrice).toFixed(2)} €</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef2f7;text-align:right;font-size:13px;font-weight:700;color:${BRAND_ORANGE};">${Number(item.total).toFixed(2)} €</td>
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
  body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #1e293b; }
</style>
</head>
<body style="margin:0;padding:0;background:#fff;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:700px;margin:0 auto;background:#ffffff;min-height:100vh;">
    <!-- Encabezado azul oscuro -->
    <div style="background:#1a3a6b;padding:20px 40px;display:flex;align-items:center;justify-content:space-between;gap:20px;">
      <div style="display:flex;align-items:center;gap:16px;flex-shrink:0;">
        <img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/logo-nayade_20a42bc4.jpg" alt="Náyade" width="90" height="90" style="display:block;border-radius:50%;border:3px solid rgba(255,255,255,0.85);object-fit:cover;" />
        <div>
          <div style="color:#fff;font-size:20px;font-weight:900;letter-spacing:2px;text-transform:uppercase;line-height:1.1;">Náyade</div>
          <div style="color:rgba(255,255,255,0.65);font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-top:3px;">Experiences</div>
        </div>
      </div>
      <div style="text-align:right;color:rgba(255,255,255,0.80);font-size:11.5px;line-height:1.7;">
        <strong style="color:#fff;font-size:12.5px;display:block;">${d.issuerName ?? 'Náyade Experiences'}</strong>
        ${d.issuerAddress ?? ''}<br/>
        ${d.issuerCif ? 'CIF: ' + d.issuerCif : ''}
      </div>
    </div>
    <!-- Banda naranja con tipo de documento -->
    <div style="background:#f97316;padding:8px 40px;display:flex;align-items:center;justify-content:space-between;">
      <span style="color:#fff;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Presupuesto</span>
      <span style="color:#fff;font-size:13px;font-weight:700;">${d.quoteNumber} &nbsp;&middot;&nbsp; ${new Date(d.createdAt).toLocaleDateString("es-ES")}${d.validUntil ? " &nbsp;&middot;&nbsp; Válido hasta: " + new Date(d.validUntil).toLocaleDateString("es-ES") : ""}</span>
    </div>

    <!-- Meta row cliente -->
    <div style="padding:24px 40px 0;display:flex;justify-content:space-between;align-items:flex-start;">
      <div style="background:#f8fafc;border-radius:8px;padding:14px 16px;border:1px solid #e5e7eb;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#1a3a6b;margin-bottom:8px;font-weight:700;">Cliente</div>
        <div style="font-size:15px;font-weight:700;color:#1a3a6b;">${d.clientName}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px;line-height:1.6;">${d.clientEmail}${d.clientPhone ? "<br/>" + d.clientPhone : ""}${d.clientCompany ? "<br/>" + d.clientCompany : ""}</div>
      </div>
    </div>

    <!-- Items table -->
    <div style="padding:20px 40px;">
      <div style="background:#f8fafc;border-radius:10px;padding:18px 22px;border:1px solid #e8eef7;">
        <p style="color:${BRAND_MID_BLUE};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;font-family:Arial,sans-serif;">${d.title}</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <thead>
            <tr style="background:${BRAND_BLUE};">
              <th style="padding:10px 12px;text-align:left;color:#fff;font-size:11px;font-weight:600;">Descripción</th>
              <th style="padding:10px 12px;text-align:center;color:#fff;font-size:11px;font-weight:600;">Cant.</th>
              <th style="padding:10px 12px;text-align:right;color:#fff;font-size:11px;font-weight:600;">Precio unit.</th>
              <th style="padding:10px 12px;text-align:right;color:#fff;font-size:11px;font-weight:600;">Total</th>
            </tr>
          </thead>
          <tbody>${itemRowsHtml}</tbody>
        </table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
          ${Number(d.discount) > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">Descuento</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:13px;">-${Number(d.discount).toFixed(2)} €</td></tr>` : ""}
          ${Number(d.tax) > 0 ? `<tr><td style="padding:4px 0;color:#6b7280;font-size:13px;">IVA</td><td style="padding:4px 0;text-align:right;color:#6b7280;font-size:13px;">${Number(d.tax).toFixed(2)} €</td></tr>` : ""}
          <tr style="background:${BRAND_BLUE};"><td style="padding:10px 12px;color:#fff;font-size:14px;font-weight:700;">TOTAL</td><td style="padding:10px 12px;text-align:right;color:${BRAND_ORANGE};font-size:22px;font-weight:900;font-family:Georgia,serif;">${Number(d.total).toFixed(2)} €</td></tr>
        </table>
      </div>
    </div>

    ${d.notes ? `<div style="padding:0 40px 16px;"><div style="background:#fff7ed;border-left:4px solid ${BRAND_ORANGE};border-radius:0 8px 8px 0;padding:14px 18px;"><p style="color:#374151;font-size:13px;margin:0;line-height:1.6;">${d.notes}</p></div></div>` : ""}
    ${d.conditions ? `<div style="padding:0 40px 16px;"><div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:18px 22px;"><p style="color:${BRAND_MID_BLUE};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 10px;">Condiciones</p><p style="color:#6b7280;font-size:13px;line-height:1.6;margin:0;">${d.conditions}</p></div></div>` : ""}
    ${d.paymentLinkUrl ? `<div style="padding:0 40px 16px;text-align:center;"><div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:16px;"><p style="color:#374151;font-size:13px;margin:0 0 6px;">Enlace de pago:</p><p style="color:${BRAND_ORANGE};font-size:13px;font-weight:600;word-break:break-all;margin:0;">${d.paymentLinkUrl}</p></div></div>` : ""}

    <!-- Footer -->
    <div style="padding:16px 40px;border-top:2px solid #1a3a6b;text-align:center;color:#9ca3af;font-size:11px;line-height:1.8;">
      <p style="margin:0;">Gracias por confiar en Náyade Experiences &middot; www.nayadeexperiences.es</p>
      <p style="margin:0;">+34 930 34 77 91 &nbsp;&middot;&nbsp; reservas@nayadeexperiences.es &nbsp;&middot;&nbsp; Los Ángeles de San Rafael, Segovia</p>
    </div>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLANTILLA 11: Confirmación de pago por transferencia bancaria (cliente)
// ═══════════════════════════════════════════════════════════════════════════════
export interface TransferConfirmationEmailData {
  clientName: string;
  invoiceNumber: string;       // FAC-2026-XXXX
  reservationRef: string;      // RES-XXXXXX
  quoteTitle: string;
  quoteNumber?: string;
  items: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: string;
  taxAmount: string;
  total: string;
  invoiceUrl?: string | null;  // URL del PDF de factura en S3
  confirmedBy?: string;        // Nombre del agente que validó
  confirmedAt?: Date;
}

export function buildTransferConfirmationHtml(d: TransferConfirmationEmailData): string {
  const confirmedDate = d.confirmedAt
    ? d.confirmedAt.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })
    : new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });

  const itemRowsHtml = d.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #eef2f7;color:#374151;font-size:13px;font-family:Arial,sans-serif;">${item.description}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:center;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">${item.quantity}</td>
          <td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;color:${BRAND_ORANGE};font-size:13px;font-weight:700;font-family:Arial,sans-serif;">${Number(item.total).toFixed(2)} &euro;</td>
        </tr>`
    )
    .join("");

  const invoiceButtonBlock = d.invoiceUrl
    ? `<tr><td style="padding:0 32px 12px;text-align:center;">
        <a href="${d.invoiceUrl}"
           style="display:inline-block;background:#f0f4f8;color:${BRAND_BLUE};border:1px solid #dce4f0;font-size:14px;font-weight:600;padding:12px 28px;border-radius:50px;text-decoration:none;font-family:Arial,sans-serif;">
          &#128196; Descargar Factura
        </a>
      </td></tr>`
    : "";

  const quoteRefRow = d.quoteNumber
    ? `<br/><span style="color:#9ca3af;font-size:12px;">Presupuesto original: <strong>${d.quoteNumber}</strong></span>`
    : "";

  const confirmedByRow = d.confirmedBy
    ? `<br/><span style="color:#9ca3af;font-size:12px;">Validado por: <strong>${d.confirmedBy}</strong></span>`
    : "";

  const body = `
    ${emailHeader("Pago Confirmado", "Tu transferencia ha sido validada")}
    <tr><td style="padding:28px 32px 0;">
      <p style="color:#1e293b;font-size:17px;margin:0 0 8px;font-family:Arial,sans-serif;">Hola <strong>${d.clientName}</strong>,</p>
      <p style="color:#6b7280;font-size:15px;margin:0 0 16px;line-height:1.7;font-family:Arial,sans-serif;">
        Hemos recibido y <strong style="color:#166534;">validado correctamente</strong> tu pago por transferencia bancaria.
        Tu reserva queda confirmada y ya puedes disfrutar de tu experiencia en N&aacute;yade.
      </p>
      ${statusBlock("success", "Transferencia bancaria validada",
        `Pago confirmado el <strong>${confirmedDate}</strong>. Tu factura est&aacute; disponible para descargar.`)}
    </td></tr>
    <tr><td style="padding:0 32px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e8eef7;">
        <tr><td style="padding:18px 22px;">
          <p style="color:${BRAND_MID_BLUE};font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;font-family:Arial,sans-serif;">${d.quoteTitle}</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <thead>
              <tr>
                <th style="text-align:left;color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding:0 0 8px;font-family:Arial,sans-serif;">Concepto</th>
                <th style="text-align:center;color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding:0 0 8px;font-family:Arial,sans-serif;">Uds.</th>
                <th style="text-align:right;color:#9ca3af;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding:0 0 8px;font-family:Arial,sans-serif;">Importe</th>
              </tr>
            </thead>
            <tbody>${itemRowsHtml}</tbody>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;border-top:1px solid #e8eef7;">
            <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">Subtotal</td><td style="padding:6px 0;text-align:right;color:#374151;font-size:13px;font-family:Arial,sans-serif;">${Number(d.subtotal).toFixed(2)} &euro;</td></tr>
            <tr><td style="padding:6px 0;color:#6b7280;font-size:13px;font-family:Arial,sans-serif;">IVA (21%)</td><td style="padding:6px 0;text-align:right;color:#374151;font-size:13px;font-family:Arial,sans-serif;">${Number(d.taxAmount).toFixed(2)} &euro;</td></tr>
            <tr style="background:${BRAND_BLUE};">
              <td style="padding:10px 12px;color:#fff;font-size:14px;font-weight:700;font-family:Arial,sans-serif;">Total pagado</td>
              <td style="padding:10px 12px;text-align:right;color:${BRAND_ORANGE};font-size:22px;font-weight:900;font-family:Georgia,serif;">${Number(d.total).toFixed(2)} &euro;</td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 32px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border-left:4px solid ${BRAND_ORANGE};border-radius:0 8px 8px 0;">
        <tr><td style="padding:14px 18px;">
          <p style="color:#374151;font-size:13px;margin:0;line-height:1.8;font-family:Arial,sans-serif;">
            ${SVG.ref}&nbsp;<strong>N&uacute;mero de factura:</strong> <span style="color:${BRAND_ORANGE};font-weight:700;">${d.invoiceNumber}</span>
            ${quoteRefRow}
            ${confirmedByRow}<br/>
            <span style="color:#9ca3af;font-size:12px;">Guarda este n&uacute;mero para cualquier consulta.</span>
          </p>
        </td></tr>
      </table>
    </td></tr>
    ${invoiceButtonBlock}
    ${emotionalBlock("El agua, la naturaleza y la emoci&oacute;n te esperan. &#161;Nos vemos pronto en el lago!")}
    <tr><td style="padding:0 32px 28px;">
      <p style="color:#9ca3af;font-size:13px;margin:0;line-height:1.6;font-family:Arial,sans-serif;">
        &iquest;Tienes alguna pregunta sobre tu reserva? Escrb&iacute;benos a
        <a href="mailto:reservas@nayadeexperiences.es" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">reservas@nayadeexperiences.es</a>
        o ll&aacute;manos al <a href="tel:+34930347791" style="color:${BRAND_ORANGE};text-decoration:none;font-weight:600;">+34 930 34 77 91</a>.
      </p>
    </td></tr>
    ${emailFooter()}`;

  return emailWrapper(`Pago confirmado — ${d.invoiceNumber} · Náyade Experiences`, body);
}
