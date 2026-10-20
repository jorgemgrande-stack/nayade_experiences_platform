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
  /** La prueba ha terminado: solo lectura, sin borrar nada; puede contratar cuando quiera. */
  const trialExpired = (i: { endsAt: number; pricingUrl?: string | null }) =>
    layout(b, `Tu prueba de ${PLATFORM_BRAND} ha terminado`, [
      `La prueba gratuita terminó el ${fmtDate(i.endsAt)}.`,
      "Tu cuenta sigue disponible en solo lectura: puedes entrar y consultar todo, pero no crear ni modificar datos. No se ha borrado nada.",
      "Cuando contrates un plan, todo vuelve a funcionar en la misma cuenta, con tus datos tal y como los dejaste.",
    ], i.pricingUrl ? { label: "Ver planes", url: i.pricingUrl } : null);
  return {
    emailVerification(i: { verifyUrl: string }) {
      return layout(b, `Confirma tu correo para empezar tu prueba de ${PLATFORM_BRAND}`, [
        "Hemos recibido una solicitud de prueba gratuita con esta dirección.",
        "Para activarla, confirma que el correo es tuyo. El enlace caduca y solo sirve una vez.",
        "Si no la has solicitado tú, ignora este mensaje: no se creará nada.",
      ], { label: "Confirmar correo", url: i.verifyUrl });
    },
    /** Reenvío del enlace de verificación: el anterior ya no sirve. */
    emailVerificationResent(i: { verifyUrl: string }) {
      return layout(b, `Tu nuevo enlace para empezar la prueba de ${PLATFORM_BRAND}`, [
        "Nos has pedido un enlace nuevo para confirmar esta dirección y activar tu prueba gratuita.",
        "Este enlace sustituye al anterior, que ya no funciona. Caduca y solo sirve una vez.",
        "Si no lo has pedido tú, ignora este mensaje: no se creará nada.",
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
    /** Aviso previo al vencimiento (3 y 1 días); con 0 días la prueba ya terminó: aviso de vencimiento. */
    trialExpiry(i: { endsAt: number; daysLeft: number; pricingUrl?: string | null }) {
      if (i.daysLeft <= 0) return trialExpired(i);
      const when = i.daysLeft === 1 ? "termina mañana" : `termina en ${i.daysLeft} días`;
      return layout(b, `Tu prueba de ${PLATFORM_BRAND} ${when}`, [
        `La prueba gratuita termina el ${fmtDate(i.endsAt)}.`,
        "Al terminar, tu cuenta pasa a solo lectura: no se borra nada y puedes contratar cuando quieras para seguir trabajando.",
      ], i.pricingUrl ? { label: "Ver planes", url: i.pricingUrl } : null);
    },
    trialExpired,
    contractConfirmed(i: { companyName: string; reference: string | null; host: string | null }) {
      return layout(b, `Contratación confirmada${i.reference ? ` · ${i.reference}` : ""}`, [
        `La contratación de ${PLATFORM_BRAND} para ${i.companyName} está activa.`,
        ...(i.reference ? [`Referencia del pedido: ${i.reference}.`] : []),
        "Las capacidades contratadas ya están disponibles en tu plataforma.",
      ], i.host ? { label: "Entrar en la plataforma", url: hostUrl(i.host)! } : null);
    },
    /** Pago de PRUEBA (proveedor simulado o Stripe en modo pruebas): no se ha cobrado dinero real. */
    testPaymentConfirmed(i: { reference: string | null; amountCents: number; currency: string }) {
      return layout(b, `Pago de prueba confirmado${i.reference ? ` · ${i.reference}` : ""}`, [
        `Hemos registrado un pago de PRUEBA de ${fmtMoney(i.amountCents, i.currency)}${i.reference ? ` para el pedido ${i.reference}` : ""}.`,
        "Es un pago del entorno de pruebas: no se ha realizado ningún cargo real.",
      ]);
    },
    /**
     * Pago REAL confirmado (Stripe en modo live). El importe es el cobrado según Stripe: aquí no se
     * calcula ni se desglosa ningún impuesto.
     */
    paymentConfirmed(i: { reference: string | null; amountCents: number; currency: string }) {
      return layout(b, `Pago confirmado${i.reference ? ` · ${i.reference}` : ""}`, [
        `Hemos recibido tu pago${i.reference ? ` del pedido ${i.reference}` : ""}. Importe cobrado: ${fmtMoney(i.amountCents, i.currency)}.`,
        "El cobro se ha realizado a través de Stripe. Con el pago confirmado activamos tu contratación y te avisaremos en cuanto esté lista.",
      ]);
    },
    /**
     * Factura disponible tras un cobro verificado en Stripe. Sin enlace: la URL alojada de la factura no
     * se guarda en el flujo de cobro, así que se remite al portal de cliente de Stripe o a soporte.
     */
    invoiceAvailable(i: { reference: string | null; invoiceRef: string | null; amountCents: number; currency: string; test: boolean }) {
      return layout(b, `${i.test ? "Factura de prueba disponible" : "Factura disponible"}${i.reference ? ` · ${i.reference}` : ""}`, [
        `La factura del cobro de ${fmtMoney(i.amountCents, i.currency)}${i.reference ? ` (pedido ${i.reference})` : ""} ya está emitida en Stripe.`,
        ...(i.invoiceRef ? [`Referencia de la factura en Stripe: ${i.invoiceRef}.`] : []),
        "Puedes consultarla y descargarla desde el portal de cliente de Stripe (Customer Portal) o pedirnos una copia respondiendo a este correo.",
        ...(i.test ? ["Es una factura del entorno de pruebas de Stripe: no corresponde a ningún cargo real."] : []),
      ]);
    },
    /** Renovación cobrada (pago verificado del periodo nuevo). */
    renewalConfirmed(i: { reference: string | null; amountCents: number; currency: string; periodStart: number | null; host: string | null; test: boolean }) {
      return layout(b, `${i.test ? "Renovación de prueba registrada" : "Renovación confirmada"}${i.reference ? ` · ${i.reference}` : ""}`, [
        i.test
          ? `Hemos registrado un cobro de PRUEBA de ${fmtMoney(i.amountCents, i.currency)} por la renovación de tu suscripción de ${PLATFORM_BRAND}${i.reference ? ` (pedido ${i.reference})` : ""}.`
          : `Hemos cobrado la renovación de tu suscripción de ${PLATFORM_BRAND}${i.reference ? ` (pedido ${i.reference})` : ""}. Importe cobrado: ${fmtMoney(i.amountCents, i.currency)}.`,
        ...(i.periodStart ? [`El nuevo periodo empieza el ${fmtDate(i.periodStart)}.`] : []),
        "Tu plataforma sigue activa, sin ninguna interrupción.",
        ...(i.test ? ["Es un cobro del entorno de pruebas: no se ha realizado ningún cargo real."] : []),
      ], i.host ? { label: "Entrar en la plataforma", url: hostUrl(i.host)! } : null);
    },
    /** Reactivación: cancelación programada deshecha, o pago pendiente regularizado tras un impago. */
    subscriptionReactivated(i: { reference: string | null; reason: "cancel_undone" | "payment_recovered"; host: string | null }) {
      const recovered = i.reason === "payment_recovered";
      return layout(b, `${recovered ? "Suscripción al corriente" : "Suscripción reactivada"}${i.reference ? ` · ${i.reference}` : ""}`, recovered
        ? ["Hemos recibido el pago pendiente de tu suscripción.", "Tu plataforma vuelve a funcionar con normalidad. No se ha borrado ningún dato."]
        : ["Has deshecho la cancelación programada de tu suscripción.", "Tu suscripción sigue activa y se renovará con normalidad al final del periodo en curso."],
      i.host ? { label: "Entrar en la plataforma", url: hostUrl(i.host)! } : null);
    },
    /** Acuse de la solicitud de alta en línea (contratación aceptada en la web, pendiente del pago). */
    signupReceived(i: { companyName: string; reference: string | null; test: boolean }) {
      return layout(b, `Hemos recibido tu solicitud de alta${i.reference ? ` · ${i.reference}` : ""}`, [
        `Hemos registrado la solicitud de contratación de ${PLATFORM_BRAND} para ${i.companyName}${i.reference ? ` (pedido ${i.reference})` : ""}.`,
        "Para completarla, termina el pago en la página segura de Stripe. No se activa nada hasta que Stripe confirme el pago; entonces te enviaremos el acceso a tu plataforma.",
        "Si no has hecho tú esta solicitud, responde a este correo y la anularemos.",
        ...(i.test ? ["Es una solicitud del entorno de pruebas: no se realizará ningún cargo real."] : []),
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
    /** Acuse de recibo del desistimiento (soporte duradero): referencia, fecha y hora, y qué pasa ahora. */
    withdrawalReceipt(i: { reference: string; requestedAt: number; withinTerm: boolean; deadlineAt: number | null }) {
      const at = new Date(i.requestedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
      return layout(b, `Hemos recibido tu desistimiento · ${i.reference}`, [
        `Hemos recibido tu solicitud de desistimiento del contrato el ${at} (hora de Madrid), con la referencia ${i.reference}. Guarda este correo como justificante.`,
        i.withinTerm
          ? `Consta presentada dentro del plazo de desistimiento${i.deadlineAt ? ` (que terminaba el ${fmtDate(i.deadlineAt)})` : ""}.`
          : "Consta presentada fuera del plazo de desistimiento. La revisaremos igualmente y te responderemos.",
        "Revisaremos la solicitud y te comunicaremos la resolución y, si procede, el reembolso por el mismo medio de pago. Este acuse no supone ningún cobro ni devolución.",
      ]);
    },
    /** Resolución del desistimiento (aceptado, rechazado con motivo o completado con el reembolso). */
    withdrawalResolution(i: { reference: string; status: string; note: string | null }) {
      const head = i.status === "accepted" ? "Hemos aceptado tu desistimiento." : i.status === "completed" ? "Hemos completado tu desistimiento." : "Hemos revisado tu solicitud de desistimiento y no podemos aceptarla.";
      return layout(b, `Tu desistimiento · ${i.reference}`, [head, ...(i.note ? [i.note] : []), "Si tienes cualquier duda, responde a este correo indicando la referencia."]);
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
