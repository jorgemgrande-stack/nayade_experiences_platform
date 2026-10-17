/**
 * Plantillas transaccionales en español (sin publicidad). Puras: no envían nada.
 *
 *  - Avisos de PLATAFORMA (los envía el plano de control): marca Elephant Source.
 *  - Avisos de EMPRESA con plantilla propia aquí (`tenantNotice`): marca de la empresa.
 *    Los correos de empresa del Core (invitación, recuperación de contraseña, presupuestos, reservas…)
 *    usan sus plantillas de siempre (`server/emailTemplates.ts`, ya con la marca y el host de la empresa en
 *    multiempresa) y salen por este mismo servicio (`server/mailer.ts`).
 *
 * Enlaces: siempre al host de la empresa (registro: dominio propio verificado o subdominio de plataforma)
 * o a la URL que pase el llamante. Nunca se inventa una dirección: la de soporte solo aparece si se
 * configura (`ELEPHANT_SUPPORT_EMAIL`).
 */
import { PLATFORM_BRAND } from "./policy";
import type { MailContent } from "./types";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
const fmtMoney = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);

export interface LayoutBrand {
  /** Nombre que firma el correo (Elephant Source o la empresa). */
  name: string;
  /** Dirección de soporte visible, o null (no se muestra). */
  supportEmail?: string | null;
}

/** Solo https (o http a la propia máquina en desarrollo): un enlace raro no entra en un correo. */
function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return u.toString();
  } catch {
    /* no válida */
  }
  return null;
}

export function layout(brand: LayoutBrand, title: string, paragraphs: string[], cta?: { label: string; url: string } | null): MailContent & { text: string } {
  const link = cta ? safeUrl(cta.url) : null;
  const footer = [
    `Mensaje automático de ${brand.name} relacionado con tu cuenta. No es publicidad.`,
    ...(brand.supportEmail ? [`¿Dudas? Escríbenos a ${brand.supportEmail}.`] : []),
  ];
  const text = [title, "", ...paragraphs, ...(link ? ["", `${cta!.label}: ${link}`] : []), "", "—", ...footer].join("\n");
  const html =
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>` +
    `<body style="margin:0;background:#f5f5f4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c1917">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px">` +
    `<p style="font-size:14px;font-weight:600;letter-spacing:.02em;color:#44403c;margin:0 0 16px">${esc(brand.name)}</p>` +
    `<div style="background:#ffffff;border-radius:8px;padding:24px">` +
    `<h1 style="font-size:20px;line-height:1.3;margin:0 0 16px">${esc(title)}</h1>` +
    paragraphs.map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 12px">${esc(p)}</p>`).join("") +
    (link
      ? `<p style="margin:20px 0 8px"><a href="${esc(link)}" style="display:inline-block;background:#1c1917;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600">${esc(cta!.label)}</a></p>` +
        `<p style="font-size:13px;line-height:1.5;color:#57534e;margin:8px 0 0">Si el botón no funciona, copia esta dirección en el navegador: ${esc(link)}</p>`
      : "") +
    `</div>` +
    footer.map((f) => `<p style="font-size:12px;line-height:1.5;color:#57534e;margin:12px 0 0">${esc(f)}</p>`).join("") +
    `</div></body></html>`;
  return { subject: title, html, text };
}

const platform = (supportEmail: string | null | undefined): LayoutBrand => ({ name: PLATFORM_BRAND, supportEmail: supportEmail ?? null });
const hostUrl = (host: string | null | undefined, path = "/") => (host ? `https://${host}${path}` : null);

export interface PlatformTemplateOptions {
  supportEmail?: string | null;
}

/** Avisos de plataforma (Elephant Source). */
export function platformTemplates(o: PlatformTemplateOptions = {}) {
  const b = platform(o.supportEmail);
  return {
    emailVerification(i: { verifyUrl: string }) {
      return layout(b, `Confirma tu correo para empezar tu prueba de ${PLATFORM_BRAND}`, [
        "Hemos recibido una solicitud de prueba gratuita con esta dirección.",
        "Para activarla, confirma que el correo es tuyo. El enlace caduca y solo sirve una vez.",
        "Si no la has solicitado tú, ignora este mensaje: no se creará nada.",
      ], { label: "Confirmar correo", url: i.verifyUrl });
    },
    /** Alta asistida (contrato del CRM): la plataforma de la empresa está creada. */
    tenantWelcome(i: { companyName: string; host: string | null; setPasswordUrl: string | null }) {
      return layout(b, `La plataforma de ${i.companyName} está lista`, [
        `Hemos creado el espacio de ${i.companyName} en ${PLATFORM_BRAND}.`,
        i.host ? `Su dirección: https://${i.host}` : "Su dirección se comunicará en cuanto esté publicada.",
        "Define tu contraseña de administrador para entrar. El enlace es personal y caduca.",
      ], i.setPasswordUrl ? { label: "Definir contraseña", url: i.setPasswordUrl } : null);
    },
    signupConfirmation(i: { companyName: string }) {
      return layout(b, `Hemos recibido el alta de ${i.companyName}`, [
        `Gracias por darte de alta en ${PLATFORM_BRAND}. Estamos preparando tu espacio.`,
        "Te escribiremos de nuevo en cuanto esté listo para entrar.",
      ]);
    },
    trialActivated(i: { host: string | null; setPasswordUrl: string | null; endsAt?: number | null }) {
      return layout(b, `Tu prueba de ${PLATFORM_BRAND} está lista`, [
        `Tu espacio de ${PLATFORM_BRAND} está activo.`,
        i.host ? `Tu dirección: https://${i.host}` : "Tu dirección se te comunicará en cuanto esté publicada.",
        ...(i.endsAt ? [`La prueba gratuita dura hasta el ${fmtDate(i.endsAt)}.`] : []),
        "Define tu contraseña de administrador para entrar. El enlace es personal y caduca.",
      ], i.setPasswordUrl ? { label: "Definir contraseña", url: i.setPasswordUrl } : null);
    },
    trialExpiry(i: { endsAt: number; daysLeft: number; pricingUrl?: string | null }) {
      const when = i.daysLeft <= 0 ? "termina hoy" : i.daysLeft === 1 ? "termina mañana" : `termina en ${i.daysLeft} días`;
      return layout(b, `Tu prueba de ${PLATFORM_BRAND} ${when}`, [
        `La prueba gratuita termina el ${fmtDate(i.endsAt)}.`,
        "Al terminar, tu cuenta pasa a solo lectura: no se borra nada y puedes contratar cuando quieras para seguir trabajando.",
      ], i.pricingUrl ? { label: "Ver planes", url: i.pricingUrl } : null);
    },
    contractConfirmed(i: { companyName: string; reference: string | null; host: string | null }) {
      return layout(b, `Contratación confirmada${i.reference ? ` · ${i.reference}` : ""}`, [
        `La contratación de ${PLATFORM_BRAND} para ${i.companyName} está activa.`,
        ...(i.reference ? [`Referencia del pedido: ${i.reference}.`] : []),
        "Las capacidades contratadas ya están disponibles en tu plataforma.",
      ], i.host ? { label: "Entrar en la plataforma", url: hostUrl(i.host)! } : null);
    },
    /** Pago de PRUEBA del proveedor simulado: no se ha cobrado dinero real. */
    testPaymentConfirmed(i: { reference: string | null; amountCents: number; currency: string }) {
      return layout(b, `Pago de prueba confirmado${i.reference ? ` · ${i.reference}` : ""}`, [
        `Hemos registrado un pago de PRUEBA de ${fmtMoney(i.amountCents, i.currency)}${i.reference ? ` para el pedido ${i.reference}` : ""}.`,
        "Es un pago del entorno de pruebas: no se ha realizado ningún cargo real.",
      ]);
    },
    paymentFailed(i: { reference: string | null; graceEndsAt: number | null; host: string | null }) {
      return layout(b, `No hemos podido cobrar tu recibo${i.reference ? ` · ${i.reference}` : ""}`, [
        "El último recibo de tu suscripción no se ha podido pagar.",
        i.graceEndsAt
          ? `Tu plataforma sigue funcionando hasta el ${fmtDate(i.graceEndsAt)}. Si para entonces no consta el pago, quedará en suspenso (sin borrar ningún dato) hasta regularizarlo.`
          : "Tu plataforma sigue funcionando de momento. Si no consta el pago, quedará en suspenso (sin borrar ningún dato) hasta regularizarlo.",
      ], i.host ? { label: "Revisar la suscripción", url: hostUrl(i.host)! } : null);
    },
    cancellation(i: { reference: string | null; cancelAt: number | null }) {
      return layout(b, `Cancelación registrada${i.reference ? ` · ${i.reference}` : ""}`, [
        "Hemos registrado la cancelación de tu suscripción.",
        i.cancelAt ? `Seguirás teniendo acceso hasta el ${fmtDate(i.cancelAt)}, fin del periodo en curso.` : "Seguirás teniendo acceso hasta el fin del periodo en curso.",
        "No se borra ningún dato. Si ha sido un error, responde a este correo o contacta con nosotros.",
      ]);
    },
  };
}

/** Aviso operativo de una empresa (con su marca y su host). */
export function tenantNotice(i: { brandName: string; replyTo?: string | null; title: string; paragraphs: string[]; host: string | null; path?: string; ctaLabel?: string }) {
  return layout({ name: i.brandName, supportEmail: i.replyTo ?? null }, i.title, i.paragraphs, i.host && i.ctaLabel ? { label: i.ctaLabel, url: hostUrl(i.host, i.path ?? "/")! } : null);
}
