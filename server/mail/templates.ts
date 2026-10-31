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
import { CORPORATE, fmt, renderEmail, type Block, type EmailSpec } from "./design";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmtDate = fmt.date;
const fmtShort = fmt.short;
const fmtMoney = fmt.money;
const SUPPORT_URL = `${CORPORATE.web}/soporte`;
/** Cierra la frase con punto sin duplicarlo («Empresa, S.L.»). */
const stop = (s: string) => (s.endsWith(".") ? s : `${s}.`);

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



/**
 * Diseño común de todos los correos: el sistema de diseño de Big Elephant (./design.ts). Las plantillas que solo
 * pasan párrafos heredan el estándar (familia transaccional); con `opts` eligen familia, antetítulo, ilustración y
 * bloques (tarjetas, avisos, pasos, línea de progreso…). Versión de texto equivalente.
 */
export function layout(brand: LayoutBrand, title: string, paragraphs: string[], cta?: { label: string; url: string } | null, opts: Partial<EmailSpec> = {}): MailContent & { text: string } {
  const [first, ...rest] = paragraphs;
  return renderEmail(brand, {
    family: "transactional",
    title,
    intro: first ? [first] : [],
    blocks: rest.map((p) => ({ p })),
    cta: cta ?? null,
    ...opts,
  });
}

/** Marca de plataforma: nombre, soporte, logotipo oficial y emisor (nunca en los avisos de una empresa). */
const platform = (supportEmail: string | null | undefined): LayoutBrand => ({ name: PLATFORM_BRAND, supportEmail: supportEmail ?? null, ...platformIdentity() });
/** Marca de plataforma para otros módulos de correo (cuentas, seguridad, exportaciones). */
export const platformBrand = (supportEmail: string | null | undefined = null): LayoutBrand => platform(supportEmail);
const hostUrl = (host: string | null | undefined, path = "/") => (host ? `https://${host}${path}` : null);

export interface PlatformTemplateOptions {
  supportEmail?: string | null;
}

/** Avisos de plataforma (Big Elephant), con el sistema de diseño aprobado. */
export function platformTemplates(o: PlatformTemplateOptions = {}) {
  const b = platform(o.supportEmail);
  const e = (s: EmailSpec) => renderEmail(b, s);
  const enter = (host: string | null | undefined, label = "Entrar en la plataforma", path = "/admin") => (host ? { label, url: hostUrl(host, path)! } : null);
  const refTitle = (r: string | null) => (r ? ` · ${r}` : "");
  /** La prueba ha terminado: solo lectura, sin borrar nada; puede contratar cuando quiera. */
  const trialExpired = (i: { endsAt: number; pricingUrl?: string | null }) =>
    e({
      family: "experiential", eyebrow: "Tu prueba gratuita", hero: "calendario",
      title: "Tu prueba ha terminado", subject: `Tu prueba de ${PLATFORM_BRAND} ha terminado`,
      intro: [`La prueba gratuita terminó el ${fmtDate(i.endsAt)}. Tu cuenta sigue disponible en solo lectura. No se ha borrado nada.`],
      blocks: [
        { card: { status: { label: "Solo lectura", tone: "warning" }, rows: [{ label: "Fin de la prueba", value: fmtDate(i.endsAt) }, { label: "Tus datos", value: "Conservados" }, { label: "Acceso", value: "Consulta, sin crear ni modificar" }] } },
        { p: "Cuando contrates un plan, todo vuelve a funcionar en la misma cuenta, con tus datos tal y como los dejaste." },
      ],
      cta: i.pricingUrl ? { label: "Ver planes", url: i.pricingUrl } : null,
    });
  return {
    emailVerification(i: { verifyUrl: string }) {
      return e({
        family: "security", eyebrow: "Verificación de tu correo", hero: "seguridad",
        title: "Confirma tu correo", subject: `Confirma tu correo para empezar tu prueba de ${PLATFORM_BRAND}`,
        intro: ["Hemos recibido una solicitud de prueba gratuita de Big Elephant con esta dirección. Confirma que es tuya para activarla."],
        blocks: [{ notice: { tone: "info", text: "El enlace caduca y solo puede usarse una vez." } }, { h2: "Si no lo has solicitado tú" }, { p: "Ignora este mensaje: no se creará ninguna cuenta." }],
        cta: { label: "Confirmar correo", url: i.verifyUrl },
      });
    },
    /** Reenvío del enlace de verificación: el anterior ya no sirve. */
    emailVerificationResent(i: { verifyUrl: string }) {
      return e({
        family: "security", eyebrow: "Verificación de tu correo", hero: "seguridad",
        title: "Tu nuevo enlace de verificación", subject: `Tu nuevo enlace para empezar la prueba de ${PLATFORM_BRAND}`,
        intro: ["Nos has pedido un enlace nuevo para confirmar esta dirección y activar tu prueba gratuita."],
        blocks: [{ notice: { tone: "info", text: "Este enlace sustituye al anterior, que ya no funciona. Caduca y solo puede usarse una vez." } }, { p: "Si no lo has pedido tú, ignora este mensaje: no se creará nada." }],
        cta: { label: "Confirmar correo", url: i.verifyUrl },
      });
    },
    /** Alta asistida (contrato del CRM): la plataforma de la empresa está creada. */
    tenantWelcome(i: { companyName: string; host: string | null; setPasswordUrl: string | null }) {
      return e({
        family: "experiential", hero: "bienvenida", title: "Bienvenido a", titleAccent: "Big Elephant", subject: `La plataforma de ${i.companyName} está lista`,
        intro: [`Hemos creado el espacio de ${stop(i.companyName)} Define tu contraseña de administrador para entrar.`],
        blocks: [
          { h2: "Tus próximos pasos" },
          { steps: [
            { icon: "empresa", title: "Configura tu empresa", text: "Datos fiscales, marca y preferencias de tu espacio de trabajo." },
            { icon: "equipo", title: "Invita a tu equipo", text: "Da acceso a tus compañeros con sus propios permisos." },
            { icon: "grafico", title: "Explora las funcionalidades", text: "Descubre los módulos que mejor se adaptan a tu negocio." },
          ] },
          ...(i.host ? [{ card: { rows: [{ label: "Dirección de tu plataforma", value: `https://${i.host}` }] } } as Block] : []),
          { notice: { tone: "info", text: "El enlace es personal y caduca." } },
          { help: { title: "¿Necesitas ayuda?", text: "Nuestro equipo está aquí para acompañarte en cada paso.", link: { label: "Contactar con soporte", url: SUPPORT_URL } } },
        ],
        cta: i.setPasswordUrl ? { label: "Definir contraseña", url: i.setPasswordUrl } : null,
      });
    },
    /**
     * Implantación asistida (server/implementation): el entorno preparado por el equipo está disponible. La prueba de
     * 15 días empieza con este aviso (nunca al pedir información); en una suscripción pactada no se menciona prueba.
     */
    implementationAvailable(i: { companyName: string; solutionName: string; host: string | null; setPasswordUrl: string | null; startMode: "trial" | "subscription"; trialEndsAt: number | null }) {
      const trial = i.startMode === "trial";
      return e({
        family: "experiential", eyebrow: "Implantación completada", hero: "bienvenida", title: "Tu entorno ya está", titleAccent: "disponible", subject: `${i.solutionName}: tu entorno de ${PLATFORM_BRAND} está disponible`,
        intro: [`Hemos terminado de preparar ${i.solutionName} para ${stop(i.companyName)} Ya puedes empezar a trabajar.`],
        blocks: [
          { card: { status: { label: "Disponible", tone: "success" }, rows: [{ label: "Solución", value: i.solutionName }, ...(i.host ? [{ label: "Dirección de tu plataforma", value: `https://${i.host}` }] : []), ...(trial && i.trialEndsAt ? [{ label: "Tu prueba gratuita dura hasta", value: fmtDate(i.trialEndsAt) }] : [])] } },
          { p: trial ? "Tu prueba gratuita de 15 días empieza hoy, con el entorno ya preparado. Durante la prueba no se realiza ningún cobro." : "Tu suscripción empieza hoy, según las condiciones que acordamos." },
          ...(i.setPasswordUrl ? [{ notice: { tone: "info", text: "El enlace para definir tu contraseña de administrador es personal y caduca." } } as Block] : []),
          { help: { title: "¿Necesitas ayuda?", text: "El equipo que ha preparado tu implantación sigue a tu disposición.", link: { label: "Contactar con soporte", url: SUPPORT_URL } } },
        ],
        cta: i.setPasswordUrl ? { label: "Definir contraseña", url: i.setPasswordUrl } : i.host ? { label: "Entrar en mi plataforma", url: `https://${i.host}` } : null,
      });
    },
    signupConfirmation(i: { companyName: string }) {
      return e({
        family: "experiential", eyebrow: "Alta recibida", hero: "bienvenida", title: "Estamos preparando tu espacio", subject: `Hemos recibido el alta de ${i.companyName}`,
        intro: [`Gracias por darte de alta en Big Elephant. Estamos preparando el espacio de ${stop(i.companyName)}`],
        blocks: [{ notice: { tone: "info", text: "Te escribiremos de nuevo en cuanto esté listo para entrar." } }],
      });
    },
    trialActivated(i: { host: string | null; setPasswordUrl: string | null; endsAt?: number | null }) {
      return e({
        family: "experiential", hero: "bienvenida", title: "¡Bienvenido a", titleAccent: "Big Elephant!", subject: `Tu prueba de ${PLATFORM_BRAND} está lista`,
        intro: ["La plataforma para equipos que quieren llevar su negocio más lejos. Tu espacio de prueba ya está activo."],
        blocks: [
          { h2: "Tus próximos pasos" },
          { p: "Configura tu espacio de trabajo y empieza a sacarle el máximo partido." },
          { steps: [
            { icon: "empresa", title: "Configura tu empresa", text: "Añade los datos de tu negocio y personaliza tu espacio de trabajo." },
            { icon: "equipo", title: "Invita a tu equipo", text: "Colabora de forma segura y eficiente." },
            { icon: "grafico", title: "Explora las funcionalidades", text: "Descubre los módulos que mejor se adaptan a tus necesidades." },
          ] },
          { card: { rows: [...(i.host ? [{ label: "Tu dirección", value: `https://${i.host}` }] : []), { label: "Plan de prueba", value: "Essential · 15 días" }, ...(i.endsAt ? [{ label: "La prueba dura hasta", value: fmtDate(i.endsAt) }] : [])] } },
          { notice: { tone: "info", text: "Durante la prueba no se realiza ningún cobro. El enlace para definir tu contraseña es personal y caduca." } },
          { help: { title: "¿Necesitas ayuda?", text: "Nuestro equipo está aquí para acompañarte en cada paso.", link: { label: "Contactar con soporte", url: SUPPORT_URL } } },
        ],
        cta: i.setPasswordUrl ? { label: "Comenzar ahora", url: i.setPasswordUrl } : null,
      });
    },
    /** Aviso previo al vencimiento (7, 3 y 1 días); con 0 días la prueba ya terminó: aviso de vencimiento. */
    trialExpiry(i: { endsAt: number; daysLeft: number; pricingUrl?: string | null }) {
      if (i.daysLeft <= 0) return trialExpired(i);
      const when = i.daysLeft === 1 ? "termina mañana" : `termina en ${i.daysLeft} días`;
      return e({
        family: "experiential", eyebrow: "Tu prueba gratuita", hero: "calendario",
        title: i.daysLeft === 1 ? "Tu prueba termina mañana" : `Te quedan ${i.daysLeft} días de prueba`, subject: `Tu prueba de ${PLATFORM_BRAND} ${when}`,
        intro: [`La prueba gratuita termina el ${fmtDate(i.endsAt)}. Elige tu plan para seguir trabajando sin interrupciones.`],
        blocks: [
          { card: { status: { label: i.daysLeft <= 2 ? "Termina pronto" : "En curso", tone: i.daysLeft <= 2 ? "warning" : "info" }, rows: [{ label: "Días restantes", value: String(i.daysLeft) }, { label: "Fin de la prueba", value: fmtDate(i.endsAt) }] } },
          { p: "Al terminar, tu cuenta pasa a solo lectura: no se borra nada y puedes contratar cuando quieras para seguir trabajando." },
        ],
        cta: i.pricingUrl ? { label: "Ver planes", url: i.pricingUrl } : null,
      });
    },
    trialExpired,
    /**
     * Cambios de la prueba que decide el equipo: ampliación, pausa y reactivación. Nunca incluye el motivo interno
     * de una pausa (puede ser sensible): solo que los datos se conservan y cómo retomarla.
     */
    trialStatus(i: { kind: "extended" | "suspended" | "reactivated"; endsAt: number | null; host: string | null }) {
      const until = i.endsAt ? fmtDate(i.endsAt) : null;
      if (i.kind === "extended")
        return e({ family: "experiential", eyebrow: "Tu prueba gratuita", hero: "exito", title: "Hemos ampliado tu prueba", subject: `Hemos ampliado tu prueba de ${PLATFORM_BRAND}`, intro: [until ? `Tu prueba gratuita dura ahora hasta el ${until}.` : "Hemos ampliado el plazo de tu prueba gratuita."], blocks: [{ p: "Sigues teniendo todo disponible, con tus datos tal y como los dejaste." }], cta: enter(i.host) });
      if (i.kind === "suspended")
        return e({ family: "security", eyebrow: "Tu prueba gratuita", hero: "aviso", title: "Tu prueba está en pausa", subject: `Tu prueba de ${PLATFORM_BRAND} está en pausa`, intro: ["Hemos pausado temporalmente el acceso a tu prueba gratuita."], blocks: [{ notice: { tone: "info", text: "Tus datos se conservan: no se ha borrado nada." } }, { help: { title: "¿Crees que es un error?", text: "Responde a este correo o escribe a soporte y lo revisamos contigo.", link: { label: "Contactar con soporte", url: SUPPORT_URL } } }] });
      return e({ family: "experiential", eyebrow: "Tu prueba gratuita", hero: "exito", title: "Tu prueba vuelve a estar activa", subject: `Tu prueba de ${PLATFORM_BRAND} vuelve a estar activa`, intro: ["Ya puedes volver a usar tu plataforma con normalidad."], blocks: until ? [{ card: { rows: [{ label: "La prueba dura hasta", value: until }] } }] : [], cta: enter(i.host) });
    },
    /** Consumo al 80 % o al 100 % de un límite del plan: qué recurso, cuánto y qué pasa ahora. */
    usageThreshold(i: { label: string; periodLabel: string; used: string; limit: string; level: "warning" | "exceeded"; hard: boolean; host: string | null }) {
      const exceeded = i.level === "exceeded";
      return e({
        family: "security", eyebrow: "Consumo de tu plan", hero: exceeded ? "aviso" : "datos",
        title: exceeded ? "Has alcanzado un límite de tu plan" : "Estás cerca de un límite de tu plan",
        subject: `${exceeded ? "Has alcanzado el límite" : "Estás cerca del límite"}: ${i.label.toLowerCase()}`,
        intro: [exceeded ? (i.hard ? "Hasta el próximo periodo no se puede usar más este recurso." : "Puedes seguir usándolo, pero conviene revisar tu plan.") : "Has superado el 80 % del límite de tu plan para este periodo."],
        blocks: [
          { card: { status: { label: exceeded ? "Límite alcanzado" : "Más del 80 %", tone: exceeded ? "error" : "warning" }, rows: [{ label: "Recurso", value: i.label }, { label: "Periodo", value: i.periodLabel }, { label: "Consumo", value: `${i.used} de ${i.limit}` }] } },
          { p: "Si lo necesitas, puedes ampliar tu plan desde el panel." },
        ],
        cta: enter(i.host, "Ver el consumo", "/admin/suscripcion/consumo"),
      });
    },
    contractConfirmed(i: { companyName: string; reference: string | null; host: string | null }) {
      return e({
        family: "transactional", eyebrow: "Confirmación de contratación", hero: "contrato", title: "Tu contratación está activa", subject: `Contratación confirmada${refTitle(i.reference)}`,
        intro: [`La contratación de Big Elephant para ${i.companyName} está activa. Las capacidades contratadas ya están disponibles en tu plataforma.`],
        blocks: [{ card: { status: { label: "Activa", tone: "success" }, rows: [{ label: "Empresa", value: i.companyName }, ...(i.reference ? [{ label: "Referencia del pedido", value: i.reference }] : [])] } }],
        cta: enter(i.host),
      });
    },
    /** Pago de PRUEBA (proveedor simulado o Stripe en modo pruebas): no se ha cobrado dinero real. */
    testPaymentConfirmed(i: { reference: string | null; amountCents: number; currency: string }) {
      return e({
        family: "transactional", eyebrow: "Entorno de pruebas", hero: "pago", title: "Pago de prueba registrado", subject: `Pago de prueba confirmado${refTitle(i.reference)}`,
        intro: ["Hemos registrado un pago del entorno de pruebas."],
        blocks: [{ card: { status: { label: "Prueba", tone: "info" }, rows: [...(i.reference ? [{ label: "Pedido", value: i.reference }] : [])], total: { label: "Importe de prueba", value: fmtMoney(i.amountCents, i.currency) } } }, { notice: { tone: "info", text: "Es un pago del entorno de pruebas: no se ha realizado ningún cargo real." } }],
      });
    },
    /**
     * Pago REAL confirmado (Stripe en modo live). El importe es el cobrado según Stripe: aquí no se
     * calcula ni se desglosa ningún impuesto.
     */
    paymentConfirmed(i: { reference: string | null; amountCents: number; currency: string }) {
      return e({
        family: "transactional", eyebrow: "Pago recibido", hero: "pago", title: "Hemos recibido tu pago", subject: `Pago confirmado${refTitle(i.reference)}`,
        intro: ["El cobro se ha realizado correctamente a través de Stripe. Con el pago confirmado activamos tu contratación y te avisaremos en cuanto esté lista."],
        blocks: [{ card: { status: { label: "Pagado", tone: "success" }, rows: [...(i.reference ? [{ label: "Pedido", value: i.reference }] : []), { label: "Medio de cobro", value: "Stripe" }], total: { label: "Importe cobrado", value: fmtMoney(i.amountCents, i.currency) } } }],
      });
    },
    /**
     * Factura disponible tras un cobro verificado en Stripe. Sin enlace: la URL alojada de la factura no
     * se guarda en el flujo de cobro, así que se remite al portal de cliente de Stripe o a soporte.
     */
    invoiceAvailable(i: { reference: string | null; invoiceRef: string | null; amountCents: number; currency: string; test: boolean }) {
      return e({
        family: "transactional", eyebrow: i.test ? "Factura de prueba" : "Factura emitida", hero: "pago", title: i.test ? "Tu factura de prueba" : "Tu factura está disponible", subject: `${i.test ? "Factura de prueba disponible" : "Factura disponible"}${refTitle(i.reference)}`,
        intro: ["La factura de tu último cobro ya está emitida en Stripe."],
        blocks: [
          { card: { status: { label: "Emitida", tone: "success" }, rows: [...(i.reference ? [{ label: "Pedido", value: i.reference }] : []), ...(i.invoiceRef ? [{ label: "Referencia en Stripe", value: i.invoiceRef }] : [])], total: { label: "Total", value: fmtMoney(i.amountCents, i.currency) } } },
          { p: "Puedes consultarla y descargarla desde el portal de cliente de Stripe (Customer Portal) o pedirnos una copia respondiendo a este correo." },
          ...(i.test ? [{ notice: { tone: "info", text: "Es una factura del entorno de pruebas de Stripe: no corresponde a ningún cargo real." } } as Block] : []),
        ],
      });
    },
    /** Renovación cobrada (pago verificado del periodo nuevo). */
    renewalConfirmed(i: { reference: string | null; amountCents: number; currency: string; periodStart: number | null; host: string | null; test: boolean }) {
      return e({
        family: "transactional", eyebrow: "Renovación de suscripción", hero: "calendario", title: i.test ? "Renovación de prueba registrada" : "Tu suscripción se ha renovado", subject: `${i.test ? "Renovación de prueba registrada" : "Renovación confirmada"}${refTitle(i.reference)}`,
        intro: ["Tu plataforma sigue activa, sin ninguna interrupción."],
        blocks: [
          { card: { status: { label: i.test ? "Prueba" : "Pagada", tone: i.test ? "info" : "success" }, rows: [...(i.reference ? [{ label: "Pedido", value: i.reference }] : []), ...(i.periodStart ? [{ label: "Nuevo periodo desde", value: fmtDate(i.periodStart) }] : [])], total: { label: i.test ? "Importe de prueba" : "Importe cobrado", value: fmtMoney(i.amountCents, i.currency) } } },
          ...(i.test ? [{ notice: { tone: "info", text: "Es un cobro del entorno de pruebas: no se ha realizado ningún cargo real." } } as Block] : []),
        ],
        cta: enter(i.host),
      });
    },
    /** Reactivación: cancelación programada deshecha, o pago pendiente regularizado tras un impago. */
    subscriptionReactivated(i: { reference: string | null; reason: "cancel_undone" | "payment_recovered"; host: string | null }) {
      const recovered = i.reason === "payment_recovered";
      return e({
        family: "transactional", eyebrow: recovered ? "Pago regularizado" : "Suscripción reactivada", hero: "exito",
        title: recovered ? "Tu servicio está restablecido" : "Tu suscripción sigue activa", subject: `${recovered ? "Suscripción al corriente" : "Suscripción reactivada"}${refTitle(i.reference)}`,
        intro: [recovered ? "Hemos recibido el pago pendiente de tu suscripción. Tu plataforma vuelve a funcionar con normalidad." : "Has deshecho la cancelación programada. Tu suscripción se renovará con normalidad al final del periodo en curso."],
        blocks: [{ card: { status: { label: "Al corriente", tone: "success" }, rows: [...(i.reference ? [{ label: "Pedido", value: i.reference }] : []), { label: "Tus datos", value: "Intactos" }] } }],
        cta: enter(i.host),
      });
    },
    /** Acuse de la solicitud de alta en línea (contratación aceptada en la web, pendiente del pago). */
    signupReceived(i: { companyName: string; reference: string | null; test: boolean }) {
      return e({
        family: "transactional", eyebrow: "Solicitud de alta", hero: "contrato", title: "Hemos recibido tu solicitud", subject: `Hemos recibido tu solicitud de alta${refTitle(i.reference)}`,
        intro: [`Hemos registrado la solicitud de contratación de Big Elephant para ${stop(i.companyName)}`],
        blocks: [
          { card: { status: { label: "Pendiente de pago", tone: "warning" }, rows: [{ label: "Empresa", value: i.companyName }, ...(i.reference ? [{ label: "Pedido", value: i.reference }] : [])] } },
          { h2: "¿Qué sucede ahora?" },
          { timeline: [{ label: "Solicitud recibida", state: "done" }, { label: "Pago en Stripe", state: "current" }, { label: "Acceso a tu plataforma", state: "todo" }] },
          { notice: { tone: "info", text: "No se activa nada hasta que Stripe confirme el pago; entonces te enviaremos el acceso a tu plataforma." } },
          { p: "Si no has hecho tú esta solicitud, responde a este correo y la anularemos." },
          ...(i.test ? [{ notice: { tone: "info", text: "Es una solicitud del entorno de pruebas: no se realizará ningún cargo real." } } as Block] : []),
        ],
      });
    },
    paymentFailed(i: { reference: string | null; graceEndsAt: number | null; host: string | null }) {
      return e({
        family: "transactional", eyebrow: "Incidencia en el cobro", hero: "aviso", title: "No hemos podido cobrar tu recibo", subject: `No hemos podido cobrar tu recibo${refTitle(i.reference)}`,
        intro: ["El último recibo de tu suscripción no se ha podido pagar. Revisa tu método de pago para evitar la suspensión del servicio."],
        blocks: [
          { card: { status: { label: "Pago pendiente", tone: "warning" }, rows: [...(i.reference ? [{ label: "Pedido", value: i.reference }] : [])], ...(i.graceEndsAt ? { foot: { label: "Tu plataforma funciona hasta", value: fmtDate(i.graceEndsAt) } } : {}) } },
          { notice: { tone: "warning", text: i.graceEndsAt ? `Si el ${fmtDate(i.graceEndsAt)} no consta el pago, la plataforma quedará en suspenso hasta regularizarlo. No se borra ningún dato.` : "Si no consta el pago, la plataforma quedará en suspenso hasta regularizarlo. No se borra ningún dato." } },
        ],
        cta: enter(i.host, "Revisar el método de pago", "/admin/suscripcion"),
      });
    },
    /** Acuse de recibo del desistimiento (soporte duradero): referencia, fecha y hora, y qué pasa ahora. */
    withdrawalReceipt(i: { reference: string; requestedAt: number; withinTerm: boolean; deadlineAt: number | null }) {
      const at = new Date(i.requestedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" });
      return e({
        family: "security", eyebrow: "Desistimiento del contrato", hero: "contrato", title: "Hemos recibido tu desistimiento", subject: `Hemos recibido tu desistimiento · ${i.reference}`,
        intro: ["Guarda este correo como justificante de tu solicitud."],
        blocks: [
          { card: { status: { label: i.withinTerm ? "Dentro de plazo" : "Fuera de plazo", tone: i.withinTerm ? "success" : "warning" }, rows: [{ label: "Referencia", value: i.reference }, { label: "Recibida el", value: `${at} (hora de Madrid)` }, ...(i.deadlineAt ? [{ label: "El plazo terminaba el", value: fmtDate(i.deadlineAt) }] : [])] } },
          { p: i.withinTerm ? "Revisaremos la solicitud y te comunicaremos la resolución y, si procede, el reembolso por el mismo medio de pago." : "La revisaremos igualmente y te responderemos." },
          { notice: { tone: "info", text: "Este acuse no supone ningún cobro ni devolución." } },
        ],
      });
    },
    /** Resolución del desistimiento (aceptado, rechazado con motivo o completado con el reembolso). */
    withdrawalResolution(i: { reference: string; status: string; note: string | null }) {
      const ok = i.status === "accepted" || i.status === "completed";
      return e({
        family: "security", eyebrow: "Desistimiento del contrato", hero: ok ? "exito" : "contrato",
        title: i.status === "accepted" ? "Hemos aceptado tu desistimiento" : i.status === "completed" ? "Desistimiento completado" : "Resolución de tu desistimiento", subject: `Tu desistimiento · ${i.reference}`,
        intro: [i.status === "accepted" ? "Hemos aceptado tu solicitud de desistimiento." : i.status === "completed" ? "Hemos completado tu desistimiento." : "Hemos revisado tu solicitud de desistimiento y no podemos aceptarla."],
        blocks: [{ card: { status: { label: ok ? "Resuelto" : "No aceptado", tone: ok ? "success" : "warning" }, rows: [{ label: "Referencia", value: i.reference }] } }, ...(i.note ? [{ p: i.note } as Block] : []), { p: "Si tienes cualquier duda, responde a este correo indicando la referencia." }],
      });
    },
    /**
     * Invitación al representante para revisar y aceptar el contrato de un servicio. El enlace es personal, de un solo
     * uso y caduca. En la misma página, tras aceptar, se autoriza el método de pago (sin cargo en ese momento).
     */
    contractInvitation(i: { companyName: string; serviceName: string; signerName: string; url: string; expiresAt: number; amountCents: number; taxRateBp: number; currency: string; firstChargeAt: number }) {
      const tax = Math.round((i.amountCents * i.taxRateBp) / 10_000);
      return e({
        family: "transactional", eyebrow: "Contrato disponible", hero: "contrato", title: "Tu contrato está listo para revisar", subject: `Contrato de ${i.serviceName} para ${i.companyName}`,
        greeting: `Hola, ${i.signerName}:`,
        intro: [`Te enviamos el contrato de ${i.serviceName} para ${i.companyName}, para que lo revises y, si estás de acuerdo, lo aceptes en línea.`],
        blocks: [
          { card: { status: { label: "Pendiente de aceptación", tone: "info" }, rows: [{ label: "Servicio", value: i.serviceName }, { label: "Cliente", value: i.companyName }, { label: "Cuota mensual", value: fmtMoney(i.amountCents, i.currency) }, { label: `IVA (${i.taxRateBp / 100} %)`, value: fmtMoney(tax, i.currency) }], total: { label: "Total mensual", value: fmtMoney(i.amountCents + tax, i.currency) }, foot: { label: "Primer cobro previsto", value: fmtDate(i.firstChargeAt) } } },
          { h2: "¿Cómo funciona?" },
          { timeline: [{ label: "Revisar el contrato", state: "current" }, { label: "Aceptar en línea", state: "todo" }, { label: "Autorizar el pago", date: "sin cargo", state: "todo" }, { label: "Primer cobro", date: fmtShort(i.firstChargeAt), state: "todo" }] },
          { notice: { tone: "info", text: `Después de aceptar, en la misma página autorizas el método de pago en Stripe, sin ningún cargo en ese momento. El enlace es personal, solo sirve una vez y caduca el ${fmtDate(i.expiresAt)}.` } },
        ],
        cta: { label: "Revisar y aceptar el contrato", url: i.url },
      });
    },
    /** Acceso a la autorización del método de pago (reenvío manual del equipo desde el CRM). */
    contractPaymentSetup(i: { companyName: string; serviceName: string; signerName: string; contractReference: string; url: string; expiresAt: number; amountCents: number; taxRateBp: number; currency: string; firstChargeAt: number }) {
      const tax = Math.round((i.amountCents * i.taxRateBp) / 10_000);
      return e({
        family: "transactional", eyebrow: "Autorización del método de pago", hero: "pago", title: "Autoriza tu método de pago", subject: `Autoriza el método de pago · contrato ${i.contractReference}`,
        greeting: `Hola, ${i.signerName}:`,
        intro: [`Tu aceptación del contrato ${i.contractReference} de ${i.serviceName} para ${i.companyName} está registrada. Falta autorizar el método de pago en Stripe.`],
        blocks: [
          { card: { status: { label: "Contrato aceptado", tone: "success" }, rows: [{ label: "Servicio", value: i.serviceName }, { label: "Cuota mensual", value: fmtMoney(i.amountCents, i.currency) }, { label: `IVA (${i.taxRateBp / 100} %)`, value: fmtMoney(tax, i.currency) }], total: { label: "Total mensual", value: fmtMoney(i.amountCents + tax, i.currency) }, foot: { label: "Primer cobro previsto", value: fmtDate(i.firstChargeAt) } } },
          { notice: { tone: "info", text: `Al autorizarlo hoy no se realiza ningún cargo. El enlace sirve hasta el ${fmtDate(i.expiresAt)} y puedes abrirlo de nuevo si no terminas.` } },
        ],
        cta: { label: "Autorizar método de pago", url: i.url },
      });
    },
    /**
     * Servicio externo contratado: Stripe confirmó la autorización del método de pago y la suscripción quedó creada y
     * programada para el primer cobro pactado. Solo con hechos confirmados (estado programado en Big Elephant).
     */
    externalScheduled(i: { signerName: string | null; companyName: string; serviceName: string; amountCents: number; taxRateBp: number; currency: string; firstChargeAt: number; acceptedAt: number | null; authorizedAt: number | null }) {
      const tax = Math.round((i.amountCents * i.taxRateBp) / 10_000);
      return e({
        family: "transactional", eyebrow: "Confirmación de contratación", hero: "contrato", title: "Tu servicio está contratado", subject: `Tu servicio ${i.serviceName} está contratado`,
        ...(i.signerName ? { greeting: `Hola, ${i.signerName}:` } : {}),
        intro: [`Hemos registrado correctamente la contratación de ${i.serviceName} para ${stop(i.companyName)}`],
        blocks: [
          { card: { status: { label: "Programada", tone: "success" }, rows: [{ label: "Servicio", value: i.serviceName }, { label: "Cliente", value: i.companyName }, { label: "Cuota mensual", value: fmtMoney(i.amountCents, i.currency) }, { label: `IVA (${i.taxRateBp / 100} %)`, value: fmtMoney(tax, i.currency) }], total: { label: "Total mensual", value: fmtMoney(i.amountCents + tax, i.currency) }, foot: { label: "Primer cobro previsto", value: fmtDate(i.firstChargeAt) } } },
          { notice: { tone: "info", text: `No se ha realizado ningún cargo en este momento. El cobro se efectuará automáticamente el ${fmtDate(i.firstChargeAt)} con el método de pago autorizado.` } },
          { h2: "¿Qué sucede ahora?" },
          { timeline: [
            { label: "Contrato firmado", ...(i.acceptedAt ? { date: fmtShort(i.acceptedAt) } : {}), state: "done" },
            { label: "Método de pago autorizado", ...(i.authorizedAt ? { date: fmtShort(i.authorizedAt) } : {}), state: "done" },
            { label: "Primer cobro", date: fmtShort(i.firstChargeAt), state: "current" },
            { label: "Facturas mensuales", date: `desde ${fmtShort(i.firstChargeAt)}`, state: "todo" },
          ] },
        ],
      });
    },
    /** Aviso INTERNO al equipo (incidencias, nuevos clientes, desistimientos, tickets). Sin datos sensibles ni enlaces con token. */
    opsNotice(i: { title: string; lines: string[] }) {
      return e({
        family: "security", eyebrow: "Aviso interno del equipo", hero: "equipo", title: i.title, subject: `[Big Elephant] ${i.title}`,
        blocks: [...i.lines.map((p) => ({ p })), { notice: { tone: "info", text: "Aviso interno del equipo de Big Elephant. Revisa el detalle en el panel de operaciones." } }],
      });
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
      return e({
        family: "security", eyebrow: "Nueva solicitud desde la web", hero: "equipo", title: i.typeLabel, subject: `[Big Elephant CRM] ${i.typeLabel} · ${i.company || i.name} · ${i.reference}`,
        blocks: [
          { card: { status: { label: i.owner ? `Responsable: ${i.owner}` : "Sin asignar", tone: i.owner ? "info" : "warning" }, rows: [
            { label: "Referencia", value: i.reference }, { label: "Recibida", value: `${at} (hora de Madrid)` }, { label: "Empresa", value: i.company || "—" }, ...(i.sector ? [{ label: "Sector", value: i.sector }] : []),
            { label: "Contacto", value: i.name }, ...(i.email ? [{ label: "Correo", value: i.email }] : []), ...(i.phone ? [{ label: "Teléfono", value: i.phone }] : []), ...(i.product ? [{ label: "Producto o servicio", value: i.product }] : []), ...(i.sourcePage ? [{ label: "Página", value: i.sourcePage }] : []),
          ] } },
          ...(i.message ? [{ p: `«${i.message.slice(0, 600)}${i.message.length > 600 ? "…" : ""}»` } as Block] : []),
          { notice: { tone: "info", text: i.crmUrl ? "Abre la ficha en el CRM para atenderla (necesitas iniciar sesión)." : "Atiéndela desde Big Elephant CRM → Leads → Solicitudes web." } },
        ],
        cta: i.crmUrl ? { label: "Abrir en el CRM", url: i.crmUrl } : null,
      });
    },
    /** Ticket de soporte: recibido, respondido, resuelto o reabierto (para quien lo abrió). */
    supportTicket(i: { kind: "received" | "replied" | "resolved" | "reopened"; ticketRef: string; subject: string }) {
      const meta = {
        received: { title: "Hemos recibido tu solicitud", text: "Te responderemos lo antes posible.", status: { label: "Recibido", tone: "info" as const } },
        replied: { title: "Tienes una respuesta del equipo", text: "El equipo de soporte ha respondido a tu solicitud. Puedes ver la respuesta en tu cuenta.", status: { label: "Respondido", tone: "info" as const } },
        resolved: { title: "Tu solicitud está resuelta", text: "Si el problema continúa, responde a este correo y la reabriremos.", status: { label: "Resuelto", tone: "success" as const } },
        reopened: { title: "Hemos reabierto tu solicitud", text: "Seguimos trabajando en ella y te mantendremos informado.", status: { label: "Reabierto", tone: "warning" as const } },
      }[i.kind];
      return e({
        family: "security", eyebrow: "Soporte", hero: i.kind === "resolved" ? "exito" : "soporte", title: meta.title, subject: `Soporte · ${i.ticketRef} · ${i.subject.slice(0, 80)}`,
        intro: [meta.text],
        blocks: [{ card: { status: meta.status, rows: [{ label: "Referencia", value: i.ticketRef }, { label: "Asunto", value: i.subject.slice(0, 120) }] } }],
      });
    },
    cancellation(i: { reference: string | null; cancelAt: number | null }) {
      return e({
        family: "transactional", eyebrow: "Cancelación confirmada", hero: "calendario", title: "Hemos registrado tu cancelación", subject: `Cancelación registrada${refTitle(i.reference)}`,
        intro: ["Lamentamos verte marchar. Tu suscripción terminará al final del periodo en curso."],
        blocks: [
          { card: { status: { label: "Baja programada", tone: "warning" }, rows: [...(i.reference ? [{ label: "Pedido", value: i.reference }] : []), { label: "Acceso hasta", value: i.cancelAt ? fmtDate(i.cancelAt) : "Fin del periodo en curso" }] } },
          { notice: { tone: "info", text: "No se borra ningún dato. Si ha sido un error, responde a este correo o contacta con nosotros." } },
        ],
      });
    },
  };
}

/** Aviso operativo de una empresa (con su marca y su host). */
export function tenantNotice(i: { brandName: string; replyTo?: string | null; title: string; paragraphs: string[]; host: string | null; path?: string; ctaLabel?: string }) {
  return layout({ name: i.brandName, supportEmail: i.replyTo ?? null }, i.title, i.paragraphs, i.host && i.ctaLabel ? { label: i.ctaLabel, url: hostUrl(i.host, i.path ?? "/")! } : null);
}
