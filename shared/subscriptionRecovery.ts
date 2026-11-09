/**
 * Recuperación comercial de una empresa cuyo panel ha quedado en consulta: prueba terminada, suscripción terminada o
 * cancelada, pago pendiente o restricción administrativa. Lógica pura (sin React) que comparten el aviso único del
 * panel, el aviso al intentar guardar y las pruebas.
 *
 * Solo PRESENTACIÓN: no concede ni quita permisos. La escritura la sigue bloqueando el servidor (licencias por
 * capacidad en capabilityRouteGuard) y los permisos vuelven solo cuando el plano de control aplica una suscripción
 * con el pago verificado (webhook de Stripe o conciliación), nunca por volver del navegador desde Stripe.
 *
 * Destinos (todos son circuitos existentes, sin pagos paralelos):
 *  - prueba terminada → contratación desde la prueba (Stripe Checkout de subscription.conversionStart) o comparador;
 *  - suscripción terminada o cancelada → comparador de planes de «Suscripción» (contratación o solicitud según las
 *    reglas del plano de control);
 *  - pago pendiente → portal de facturación de Stripe (solo la persona propietaria) o la pestaña de facturación;
 *  - restricción administrativa → soporte, sin pago.
 *
 * Consulta: los textos solo prometen lo que permite hoy el servidor (subscription.overview.consultation, calculado con
 * decide()): consulta sin plazo (prueba vencida), consulta hasta una fecha (los READ_ONLY_DAYS tras terminar la
 * suscripción) o sin consulta (plazo vencido, suspendida o cancelada). Sin consulta quedan la exportación de la
 * persona propietaria y el soporte (exentos del bloqueo); los datos se conservan (nada los borra automáticamente).
 */

/** Estado de la suscripción tal como lo da subscription.overview (server/subscriptionOverview.ts). */
export type RecoveryState = "trial" | "trial_expired" | "active" | "read_only" | "suspended" | "cancelled" | "pending" | "none";

/** Derecho de consulta tal como lo da subscription.overview (SubscriptionConsultation en server/subscriptionOverview.ts). */
export interface RecoveryConsultation {
  available: boolean;
  until: number | null;
  endedAt: number | null;
}

export interface RecoveryInput {
  /** subscription.overview (null mientras carga o con error: sin aviso). Sin `consultation`, no se promete consulta. */
  overview: { licensing: "legacy" | "capabilities"; state: RecoveryState; plan: { key: string } | null; consultation?: RecoveryConsultation | null } | null | undefined;
  /** subscription.plan («Mi plan»; solo la administración, null si no aplica). */
  contract?: { contract: { state: string } | null; billing: { status: string | null } } | null;
  /** ¿La persona es de la administración de la empresa? Solo ella contrata o reactiva. */
  isAdmin: boolean;
  /** subscription.billingPortalStatus.enabled (solo la persona propietaria con el portal activo). */
  portalEnabled?: boolean;
  /** subscription.conversionStatus.enabled (contratación desde la prueba disponible). */
  conversionEnabled?: boolean;
}

export type RecoveryKind = "trial_ended" | "subscription_ended" | "payment_pending" | "restricted";

export type RecoveryAction = { type: "link"; href: string } | { type: "portal"; fallbackHref: string };

export interface RecoveryView {
  kind: RecoveryKind;
  tone: "warning" | "danger";
  /** ¿El panel está en consulta (crear y editar bloqueado)? Un pago pendiente en periodo de gracia no lo está. */
  readOnly: boolean;
  /** ¿Se puede consultar hoy la información del panel? null si el servidor no lo ha indicado. */
  canConsult: boolean | null;
  title: string;
  text: string;
  /** Acción principal; null si esta persona no puede hacer nada (lo dice `secondary`). */
  cta: { label: string; action: RecoveryAction } | null;
  /** Línea complementaria (consulta, exportación…); vacía si no hay nada cierto que añadir. */
  secondary: string;
}

export const SUBSCRIPTION_PATH = "/admin/suscripcion";
export const PLANS_HREF = `${SUBSCRIPTION_PATH}#planes`;
export const SUPPORT_HREF = "/admin/soporte";

/** Estados del pedido o del cobro en Stripe que indican un recibo sin pagar. */
const PAYMENT_PENDING_STATES = new Set(["past_due", "unpaid", "incomplete"]);
/** El pedido se suspende al acabar la gracia por impago (orquestador): también es un pago pendiente. */
const ORDER_UNPAID_STATES = new Set(["past_due", "suspended"]);
/** Planes que se contratan desde la prueba en el panel (shared/connectMarketplace.ts CONVERSION_PLAN_KEYS). */
const CONVERTIBLE_PLANS = new Set(["essential", "business"]);

const KEEP_BROWSING = "Puedes seguir consultando tu información mientras tanto.";
/** La exportación (solo la persona propietaria) sigue disponible en consulta y después (exenta del bloqueo). */
const EXPORT_LINE = "La persona propietaria de la empresa puede exportar los datos desde «Suscripción».";

/** Fecha de un plazo en hora peninsular (Europe/Madrid), como el resto del panel: «9 de diciembre de 2026». */
export function formatConsultDate(ms: number): string {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" }).format(new Date(ms));
}

/**
 * Fin de un plazo con la hora («9 de diciembre de 2026 a las 11:00»): el plazo vence a una hora concreta
 * (decide(): `validUntil <= now`), así que solo la fecha prometería el día entero.
 */
export function formatConsultDeadline(ms: number): string {
  const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Madrid" }).format(new Date(ms));
  return `${formatConsultDate(ms)} a las ${time}`;
}

/** Consulta de hoy: sin plazo, hasta una fecha, terminada (con la fecha si consta) o desconocida. */
type Consult = { kind: "open" } | { kind: "until"; date: string } | { kind: "closed"; date: string | null } | { kind: "unknown" };

function consultOf(c: RecoveryConsultation | null | undefined): Consult {
  if (!c) return { kind: "unknown" };
  if (c.available) return c.until !== null ? { kind: "until", date: formatConsultDeadline(c.until) } : { kind: "open" };
  return { kind: "closed", date: c.endedAt !== null ? formatConsultDate(c.endedAt) : null };
}

const canConsult = (c: Consult) => (c.kind === "unknown" ? null : c.kind === "open" || c.kind === "until");
/** «Siguen disponibles» solo si hoy se pueden consultar; si no, se conservan (nada se borra automáticamente). */
const dataLead = (c: Consult) => (canConsult(c) ? "Tus datos siguen disponibles." : "Tus datos se conservan.");
/** Frase de consulta cuando se puede consultar; null si no. */
function consultLine(c: Consult): string | null {
  if (c.kind === "open") return KEEP_BROWSING;
  if (c.kind === "until") return `Puedes consultar tu información en solo lectura hasta el ${c.date}.`;
  return null;
}
/** Sin consulta tras terminar el plazo de solo lectura (o sin consulta por otra causa). */
const closedLine = (c: Consult) => (c.kind === "closed" ? (c.date ? `El plazo de consulta terminó el ${c.date}.` : "La consulta del panel ya no está disponible.") : null);
const join = (...parts: Array<string | null>) => parts.filter((p): p is string => !!p).join(" ");

/** ¿Todo el panel queda en consulta (prueba o suscripción terminada, o restringida)? */
export function isPanelReadOnlyState(state: string | null | undefined): boolean {
  return state === "trial_expired" || state === "read_only" || state === "cancelled" || state === "suspended";
}

export function isPaymentPending(contract: RecoveryInput["contract"]): boolean {
  if (!contract) return false;
  return (!!contract.contract && ORDER_UNPAID_STATES.has(contract.contract.state)) || PAYMENT_PENDING_STATES.has(contract.billing.status ?? "");
}

/** Qué ve y a dónde lleva el aviso de recuperación; null si la empresa no lo necesita (activa, en prueba, legacy…). */
export function resolveRecovery(i: RecoveryInput): RecoveryView | null {
  const o = i.overview;
  if (!o || o.licensing !== "capabilities") return null;
  const readOnly = isPanelReadOnlyState(o.state);
  const c = consultOf(o.consultation);

  // 1) Pago pendiente: se recupera el cobro (manda sobre la suspensión, que suele ser su consecuencia)
  if (isPaymentPending(i.contract) && (readOnly || o.state === "active")) {
    const action: RecoveryAction = i.portalEnabled ? { type: "portal", fallbackHref: SUBSCRIPTION_PATH } : { type: "link", href: SUBSCRIPTION_PATH };
    return {
      kind: "payment_pending",
      tone: "warning",
      readOnly,
      canConsult: canConsult(c),
      title: readOnly ? "Tu suscripción está pendiente de pago" : "Tienes un pago pendiente",
      text: readOnly
        ? `${dataLead(c)} Actualiza tu método de pago para volver a gestionar tu negocio con todas tus herramientas.`
        : "Actualiza tu método de pago para seguir gestionando tu negocio sin interrupciones.",
      // Sin portal (administración que no es la propietaria) el botón solo lleva a ver la suscripción
      cta: i.isAdmin ? { label: !i.portalEnabled ? "Ver mi suscripción" : readOnly ? "Reactivar mi plan" : "Actualizar el pago", action } : null,
      secondary: !i.isAdmin
        ? "Avisa a la administración de tu empresa para que actualice el pago."
        : i.portalEnabled
          ? readOnly
            ? (consultLine(c) ?? join(c.kind === "closed" ? "Mientras tanto no se puede consultar la información del panel." : null, EXPORT_LINE))
            : "El pago se gestiona en el portal seguro de nuestro proveedor de cobros."
          : "Solo la persona propietaria de la empresa puede actualizar el pago.",
    };
  }

  // 2) Restricción administrativa: explicación y soporte, nunca un pago
  if (o.state === "suspended") {
    return {
      kind: "restricted",
      tone: "danger",
      readOnly,
      canConsult: canConsult(c),
      title: "Tu cuenta está restringida temporalmente",
      text: `${dataLead(c)} Nuestro equipo de soporte te explicará el motivo y cómo restablecer el acceso.`,
      cta: { label: "Contactar con soporte", action: { type: "link", href: SUPPORT_HREF } },
      secondary:
        consultLine(c) ??
        join(c.kind === "closed" ? "Mientras dure la restricción no se puede consultar la información del panel." : null, i.isAdmin ? EXPORT_LINE : null),
    };
  }

  // 3) Prueba terminada: contratar el plan que se estaba probando
  if (o.state === "trial_expired") {
    const plan = o.plan?.key ?? "";
    const href = i.conversionEnabled && CONVERTIBLE_PLANS.has(plan) ? `${SUBSCRIPTION_PATH}?contratar=${plan}#contratar` : PLANS_HREF;
    return {
      kind: "trial_ended",
      tone: "warning",
      readOnly,
      canConsult: canConsult(c),
      title: "Tu periodo de prueba ha finalizado",
      text: `${dataLead(c)} Contrata tu plan para volver a gestionar tu negocio con todas tus herramientas.`,
      cta: i.isAdmin ? { label: "Contratar mi plan", action: { type: "link", href } } : null,
      secondary: i.isAdmin
        ? (consultLine(c) ?? join(closedLine(c), EXPORT_LINE))
        : join("Pide a la administración de tu empresa que contrate el plan.", consultLine(c) ?? closedLine(c)),
    };
  }

  // 4) Suscripción terminada o cancelada: reactivación o nueva contratación desde el comparador
  if (o.state === "read_only" || o.state === "cancelled") {
    return {
      kind: "subscription_ended",
      tone: "warning",
      readOnly,
      canConsult: canConsult(c),
      title: "Tu suscripción ha finalizado",
      text: `${dataLead(c)} Reactiva tu plan para volver a gestionar tu negocio con todas tus herramientas.`,
      cta: i.isAdmin ? { label: "Reactivar mi plan", action: { type: "link", href: PLANS_HREF } } : null,
      secondary: i.isAdmin
        ? (consultLine(c) ?? join(closedLine(c), EXPORT_LINE))
        : join("Pide a la administración de tu empresa que reactive el plan.", consultLine(c) ?? closedLine(c)),
    };
  }
  return null;
}

/** Aviso al intentar crear, editar o guardar con el panel en consulta (o con una función en solo lectura). */
export interface BlockedNotice {
  title: string;
  description: string;
  action: { label: string; href: string } | null;
}

export function blockedNotice(view: RecoveryView | null): BlockedNotice {
  if (!view || !view.readOnly) {
    // Una función concreta en solo lectura con el plan en vigor (p. ej. un módulo que ha caducado)
    return {
      title: "Esta función está en solo lectura",
      description: "Tu plan permite consultarla, pero no hacer cambios.",
      action: { label: "Ver mi suscripción", href: SUBSCRIPTION_PATH },
    };
  }
  const href = view.cta ? (view.cta.action.type === "link" ? view.cta.action.href : view.cta.action.fallbackHref) : null;
  return {
    title: "No se pueden guardar cambios",
    description:
      view.kind === "restricted"
        ? view.canConsult
          ? "Tu cuenta está restringida temporalmente. Puedes seguir consultando tu información."
          : "Tu cuenta está restringida temporalmente. Nuestro equipo de soporte te ayudará a restablecer el acceso."
        : view.kind === "trial_ended"
          ? "Tu periodo de prueba ha finalizado. Contrata tu plan para volver a crear y editar; tus datos se conservan."
          : view.kind === "payment_pending"
            ? "Tu suscripción está pendiente de pago. Actualiza el pago para volver a crear y editar; tus datos se conservan."
            : "Tu suscripción ha finalizado. Reactiva tu plan para volver a crear y editar; tus datos se conservan.",
    action: view.cta && href ? { label: view.cta.label, href } : null,
  };
}

type ErrorData = { code?: unknown; httpStatus?: unknown; capability?: unknown; status?: unknown };

/**
 * ¿Es el rechazo tipado de escritura por licencia en consulta (capabilityRouteGuard: 403 con la capacidad y el estado
 * `read_only` o `expired`)? Acepta el error del cliente tRPC (`data`/`shape.data`) o el cuerpo HTTP del guardián.
 */
export function isReadOnlyBlockError(err: unknown): boolean {
  const e = err as { data?: ErrorData; shape?: { data?: ErrorData }; error?: { json?: { data?: ErrorData } } } | null | undefined;
  const d = e?.data ?? e?.shape?.data ?? e?.error?.json?.data;
  if (!d || typeof d !== "object") return false;
  return (d.httpStatus === 403 || d.code === "FORBIDDEN") && typeof d.capability === "string" && (d.status === "read_only" || d.status === "expired");
}
