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
import { PLATFORM_BRAND, platformIdentity } from "./policy";
import type { MailContent } from "./types";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
const fmtMoney = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);

export interface LayoutBrand {
  /** Nombre que firma el correo (Elephant Source o la empresa). */
  name: string;
  /** Dirección de soporte visible, o null (no se muestra). */
  supportEmail?: string | null;
  /** Logotipo (https absoluta). Solo los avisos de plataforma; sin él, el nombre como cabecera. */
  logoUrl?: string | null;
  /** Línea del emisor en el pie (solo plataforma). */
  legal?: string | null;
}

/** Paleta y tipografía de la marca (mismos valores que la web): grafito, rojo de acento y fondo cálido. */
const C = { ink: "#171d28", text: "#374151", muted: "#6b7280", accent: "#ff3035", paper: "#f7f5f1", card: "#ffffff", line: "#e3ddd3" };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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

/**
 * Diseño común de todos los correos: maquetación con tablas (Outlook, Gmail, Apple Mail y móviles), ancho máximo
 * de 600 px, texto previo de la bandeja (el primer párrafo), cabecera con logotipo o nombre, tarjeta con acento,
 * botón «a prueba de clientes» y pie con el aviso transaccional y, en plataforma, el emisor. Todo valor variable
 * se escapa; los enlaces solo son https (`safeUrl`). Versión de texto equivalente.
 */
export function layout(brand: LayoutBrand, title: string, paragraphs: string[], cta?: { label: string; url: string } | null): MailContent & { text: string } {
  const link = cta ? safeUrl(cta.url) : null;
  const footer = [
    `Mensaje automático de ${brand.name} relacionado con tu cuenta. No es publicidad.`,
    ...(brand.supportEmail ? [`¿Dudas? Escríbenos a ${brand.supportEmail}.`] : []),
    ...(brand.legal ? [brand.legal] : []),
  ];
  const text = [title, "", ...paragraphs, ...(link ? ["", `${cta!.label}: ${link}`] : []), "", "—", ...footer].join("\n");
  const logo = brand.logoUrl ? safeUrl(brand.logoUrl) : null;
  const preheader = (paragraphs[0] ?? title).slice(0, 140);
  const font = `font-family:${FONT}`;
  const head = logo
    ? `<img src="${esc(logo)}" width="196" height="24" alt="${esc(brand.name)} · Big Elephant" style="display:block;border:0;outline:none;width:196px;height:auto;max-width:100%">`
    : `<span style="${font};font-size:15px;font-weight:700;letter-spacing:.01em;color:${C.ink}">${esc(brand.name)}</span>`;
  const button = link
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px"><tr>` +
      // Relleno y color en la CELDA (Outlook de escritorio ignora el relleno de los enlaces y pegaba el texto al borde)
      `<td bgcolor="${C.ink}" style="border-radius:8px;background:${C.ink};padding:13px 24px;mso-padding-alt:13px 24px"><a href="${esc(link)}" target="_blank" style="display:inline-block;${font};font-size:15px;font-weight:600;line-height:1.2;color:#ffffff;text-decoration:none">${esc(cta!.label)}</a></td>` +
      `</tr></table>` +
      `<p style="margin:12px 0 0;${font};font-size:13px;line-height:1.5;color:${C.muted}">Si el botón no funciona, copia esta dirección en el navegador:<br><span style="word-break:break-all">${esc(link)}</span></p>`
    : "";
  const html =
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(title)}</title>` +
    `<style>@media (max-width:620px){.es-outer{padding:16px 10px!important}.es-card{padding:26px 22px!important}.es-h1{font-size:20px!important}}</style></head>` +
    `<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper}"><tr><td align="center" class="es-outer" style="padding:32px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">` +
    `<tr><td style="padding:0 4px 18px">${head}</td></tr>` +
    `<tr><td class="es-card" style="background:${C.card};border:1px solid ${C.line};border-top:4px solid ${C.accent};border-radius:12px;padding:32px 36px">` +
    `<h1 class="es-h1" style="margin:0 0 16px;${font};font-size:22px;font-weight:700;line-height:1.3;color:${C.ink}">${esc(title)}</h1>` +
    paragraphs.map((p) => `<p style="margin:0 0 14px;${font};font-size:15px;line-height:1.6;color:${C.text}">${esc(p)}</p>`).join("") +
    button +
    `</td></tr>` +
    `<tr><td style="padding:20px 8px 0">` +
    footer.map((f) => `<p style="margin:0 0 6px;${font};font-size:12px;line-height:1.55;color:${C.muted}">${esc(f)}</p>`).join("") +
    `</td></tr></table></td></tr></table></body></html>`;
  return { subject: title, html, text };
}

/** Marca de plataforma: nombre, soporte, logotipo oficial y emisor (nunca en los avisos de una empresa). */
const platform = (supportEmail: string | null | undefined): LayoutBrand => ({ name: PLATFORM_BRAND, supportEmail: supportEmail ?? null, ...platformIdentity() });
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
    /** Aviso previo al vencimiento (7, 3 y 1 días); con 0 días la prueba ya terminó: aviso de vencimiento. */
    trialExpiry(i: { endsAt: number; daysLeft: number; pricingUrl?: string | null }) {
      if (i.daysLeft <= 0) return trialExpired(i);
      const when = i.daysLeft === 1 ? "termina mañana" : `termina en ${i.daysLeft} días`;
      return layout(b, `Tu prueba de ${PLATFORM_BRAND} ${when}`, [
        `La prueba gratuita termina el ${fmtDate(i.endsAt)}.`,
        "Al terminar, tu cuenta pasa a solo lectura: no se borra nada y puedes contratar cuando quieras para seguir trabajando.",
      ], i.pricingUrl ? { label: "Ver planes", url: i.pricingUrl } : null);
    },
    trialExpired,
    /**
     * Cambios de la prueba que decide el equipo: ampliación, pausa y reactivación. Nunca incluye el motivo interno
     * de una pausa (puede ser sensible): solo que los datos se conservan y cómo retomarla.
     */
    trialStatus(i: { kind: "extended" | "suspended" | "reactivated"; endsAt: number | null; host: string | null }) {
      const enter = i.host ? { label: "Entrar en la plataforma", url: hostUrl(i.host)! } : null;
      const until = i.endsAt ? `La prueba gratuita dura ahora hasta el ${fmtDate(i.endsAt)}.` : null;
      if (i.kind === "extended")
        return layout(b, `Hemos ampliado tu prueba de ${PLATFORM_BRAND}`, [until ?? "Hemos ampliado el plazo de tu prueba gratuita.", "Sigues teniendo todo disponible, con tus datos tal y como los dejaste."], enter);
      if (i.kind === "suspended")
        return layout(b, `Tu prueba de ${PLATFORM_BRAND} está en pausa`, [
          "Hemos pausado temporalmente el acceso a tu prueba gratuita.",
          "Tus datos se conservan: no se ha borrado nada.",
          "Si crees que es un error o quieres retomarla, responde a este correo o escribe a soporte.",
        ]);
      return layout(b, `Tu prueba de ${PLATFORM_BRAND} vuelve a estar activa`, ["Ya puedes volver a usar tu plataforma con normalidad.", ...(until ? [until] : [])], enter);
    },
    /** Consumo al 80 % o al 100 % de un límite del plan: qué recurso, cuánto y qué pasa ahora. */
    usageThreshold(i: { label: string; periodLabel: string; used: string; limit: string; level: "warning" | "exceeded"; hard: boolean; host: string | null }) {
      const cta = i.host ? { label: "Ver el consumo", url: hostUrl(i.host, "/admin/suscripcion/consumo")! } : null;
      const now = `${i.label} (${i.periodLabel}): ${i.used} de ${i.limit}.`;
      if (i.level === "warning")
        return layout(b, `Estás cerca del límite: ${i.label.toLowerCase()}`, [now, "Has superado el 80 % del límite de tu plan para este periodo.", "Si crees que lo vas a necesitar, puedes ampliar tu plan desde el panel."], cta);
      return layout(b, `Has alcanzado el límite: ${i.label.toLowerCase()}`, [
        now,
        i.hard ? "Hasta el próximo periodo no se puede usar más este recurso." : "Puedes seguir usándolo, pero conviene revisar tu plan.",
        "Si lo necesitas, amplía tu plan desde el panel.",
      ], cta);
    },
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
    /**
     * Invitación al representante para revisar y aceptar el contrato de un servicio. El enlace es personal, de un solo
     * uso y caduca; aceptar no autoriza ningún cobro (la autorización del método de pago es un paso posterior).
     */
    contractInvitation(i: { companyName: string; serviceName: string; signerName: string; url: string; expiresAt: number; amountCents: number; taxRateBp: number; currency: string; firstChargeAt: number }) {
      const tax = Math.round((i.amountCents * i.taxRateBp) / 10_000);
      return layout(b, `Contrato de ${i.serviceName} para ${i.companyName}`, [
        `Hola, ${i.signerName}:`,
        `Te enviamos el contrato de ${i.serviceName} para ${i.companyName}, para que lo revises y, si estás de acuerdo, lo aceptes en línea.`,
        `Cuota: ${fmtMoney(i.amountCents, i.currency)} + IVA ${fmtMoney(tax, i.currency)} = ${fmtMoney(i.amountCents + tax, i.currency)} al mes. Primer vencimiento: ${fmtDate(i.firstChargeAt)}.`,
        "Aceptar el contrato no autoriza ningún cobro: después te enviaremos un enlace aparte para registrar el método de pago en Stripe, sin cargo en ese momento.",
        `El enlace es personal, solo sirve una vez y caduca el ${fmtDate(i.expiresAt)}. Si no esperabas este correo, ignóralo.`,
      ], { label: "Revisar y aceptar el contrato", url: i.url });
    },
    /** Tras aceptar el contrato: enlace para autorizar el método de pago en Stripe (hoy sin cargo). */
    contractPaymentSetup(i: { companyName: string; serviceName: string; signerName: string; contractReference: string; url: string; expiresAt: number; amountCents: number; taxRateBp: number; currency: string; firstChargeAt: number }) {
      const tax = Math.round((i.amountCents * i.taxRateBp) / 10_000);
      return layout(b, `Autoriza el método de pago · contrato ${i.contractReference}`, [
        `Hola, ${i.signerName}:`,
        `Hemos registrado tu aceptación del contrato ${i.contractReference} de ${i.serviceName} para ${i.companyName}. Gracias.`,
        "Falta un paso: autorizar el método de pago en Stripe, la plataforma de pagos segura que usa Big Elephant.",
        `Al autorizarlo hoy no se realiza ningún cargo. Las cuotas del contrato (${fmtMoney(i.amountCents, i.currency)} + IVA ${fmtMoney(tax, i.currency)} = ${fmtMoney(i.amountCents + tax, i.currency)} al mes) se cobrarán desde el ${fmtDate(i.firstChargeAt)}, como se indica en el contrato.`,
        `El enlace sirve hasta el ${fmtDate(i.expiresAt)} y puedes abrirlo de nuevo si no terminas. Si ha caducado, pide uno nuevo a tu contacto de Big Elephant.`,
      ], { label: "Autorizar método de pago", url: i.url });
    },
    /** Aviso INTERNO al equipo (incidencias, nuevos clientes, desistimientos, tickets). Sin datos sensibles ni enlaces con token. */
    opsNotice(i: { title: string; lines: string[] }) {
      return layout(b, `[Elephant Source] ${i.title}`, [...i.lines, "Aviso interno del equipo de Elephant Source. Revisa el detalle en el panel de operaciones."]);
    },
    /**
     * Aviso INTERNO de una solicitud nueva de la web al equipo comercial: solo lo que la persona escribió en el
     * formulario y el enlace a su ficha del CRM (que exige iniciar sesión). Nunca tokens, claves ni datos internos.
     */
    leadRequestNotice(i: {
      typeLabel: string;
      reference: string;
      receivedAt: number;
      company: string | null;
      name: string;
      email: string | null;
      phone: string | null;
      sector: string | null;
      product: string | null;
      message: string | null;
      sourcePage: string | null;
      owner: string | null;
      crmUrl: string | null;
    }) {
      const at = new Date(i.receivedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" });
      const lines = [
        `Nueva solicitud desde la web: ${i.typeLabel}.`,
        `Recibida el ${at} (hora de Madrid) · referencia ${i.reference}.`,
        `Empresa: ${i.company || "—"}${i.sector ? ` · sector: ${i.sector}` : ""}.`,
        `Contacto: ${i.name}${i.email ? ` · ${i.email}` : ""}${i.phone ? ` · ${i.phone}` : ""}.`,
        ...(i.product ? [`Producto o servicio: ${i.product}.`] : []),
        ...(i.message ? [`Mensaje: «${i.message.slice(0, 600)}${i.message.length > 600 ? "…" : ""}»`] : []),
        ...(i.sourcePage ? [`Enviada desde la página ${i.sourcePage}.`] : []),
        `Responsable: ${i.owner ?? "sin asignar"}.`,
        i.crmUrl ? "Abre la ficha en el CRM para atenderla (necesitas iniciar sesión)." : "Atiéndela desde Big Elephant CRM → Leads → Solicitudes web.",
      ];
      return layout(b, `[Big Elephant CRM] ${i.typeLabel} · ${i.company || i.name} · ${i.reference}`, lines, i.crmUrl ? { label: "Abrir en el CRM", url: i.crmUrl } : null);
    },
    /** Ticket de soporte: recibido, respondido, resuelto o reabierto (para quien lo abrió). */
    supportTicket(i: { kind: "received" | "replied" | "resolved" | "reopened"; ticketRef: string; subject: string }) {
      const head =
        i.kind === "received"
          ? "Hemos recibido tu solicitud de soporte. Te responderemos lo antes posible."
          : i.kind === "replied"
            ? "El equipo de soporte ha respondido a tu solicitud. Puedes ver la respuesta en tu cuenta."
            : i.kind === "resolved"
              ? "Hemos dado por resuelta tu solicitud. Si el problema continúa, responde a este correo y la reabriremos."
              : "Hemos reabierto tu solicitud y seguimos con ella.";
      return layout(b, `Soporte · ${i.ticketRef} · ${i.subject.slice(0, 80)}`, [head, `Referencia: ${i.ticketRef}.`]);
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
