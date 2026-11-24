/**
 * Cabecera de «Suscripción» (modelo puro, sin consultas): plan, estado, fecha que importa (fin de la prueba,
 * renovación, fin del servicio o plazo para pagar), situación del cobro, qué pasa con los datos y la acción principal.
 *
 * No inventa estados ni transiciones: el estado es el de subscription.overview y el cobro, el de subscription.plan.
 * Los textos de los casos excepcionales (pago pendiente, restricción, prueba o suscripción terminadas) son los mismos
 * que el aviso del panel (resolveRecovery), que en esta página no se muestra.
 */
import { formatConsultDate, isPaymentPending, resolveRecovery, subscriptionEndedText, SUPPORT_HREF, type RecoveryConsultation, type RecoveryState } from "./subscriptionRecovery";

export type HeaderTone = "info" | "success" | "warning" | "danger" | "neutral";

/** Acción de la cabecera: la página decide cómo ejecutarla (desplazarse, abrir el portal, navegar). */
export type HeaderAction =
  | { kind: "convert"; label: string }
  | { kind: "plans"; label: string }
  | { kind: "portal"; label: string }
  | { kind: "billing"; label: string }
  | { kind: "link"; label: string; href: string };

export interface HeaderFact {
  id: "trial" | "renewal" | "end" | "amount" | "payment" | "grace";
  label: string;
  value: string;
  tone?: HeaderTone;
}

/** Contratación formalizada (acuerdo aceptado) tal como la devuelve subscription.plan → customTerms.contracting. */
export interface ContractingInput {
  planName: string | null;
  extensions: string[];
  acceptedAt: number | null;
  stage: string;
  /** Solo true con el cobro enlazado por webhook verificado de Stripe. */
  paymentMethodAuthorized: boolean;
  trialActive: boolean;
  trialEndsAt: number | null;
  /** Primer cobro (o próximo) PREVISTO; nunca un cobro efectuado. */
  nextChargeAt: number | null;
  recurring: { netCents: number; taxCents: number; totalCents: number; currency: string } | null;
}

/** Panel «Plan contratado»: lo ya formalizado, separado del plan de prueba en uso. */
export interface ContractedPanel {
  title: string;
  /** «Business» (plan contratado) o null si el acuerdo no incluye plan. */
  planName: string | null;
  extensions: string[];
  /** Hechos confirmados por las fuentes reales (contratación formalizada, método de pago registrado). */
  confirmations: Array<{ id: "formalized" | "payment_method"; label: string; tone: HeaderTone }>;
  /** Cuota pactada (no es un cobro). */
  fee: { label: string; value: string } | null;
  /** Primer cobro PREVISTO, con su importe; distinto de un cobro efectuado. */
  firstCharge: { label: string; value: string; note: string } | null;
  /** Qué sucede al terminar la prueba. */
  afterTrial: string;
}

export interface SubscriptionHeaderModel {
  /** «Tu plan actual», «Plan en prueba» o «Tu plan anterior». */
  eyebrow: string;
  planName: string;
  status: { label: string; tone: HeaderTone };
  facts: HeaderFact[];
  /** Qué pasa con los datos (siempre que haya algo cierto que decir). */
  dataNote: string | null;
  /** Restricción vigente que no se oculta (solo lectura, restricción…). */
  restriction: string | null;
  primary: HeaderAction | null;
  secondary: HeaderAction | null;
  /** Solo con una contratación ya formalizada durante la prueba (cualquier empresa): sustituye a «Contrata un plan». */
  contracted?: ContractedPanel | null;
}

export interface SubscriptionHeaderInput {
  overview: {
    licensing: "legacy" | "capabilities";
    state: RecoveryState;
    plan: { key: string; name: string } | null;
    trial: { endsAt: number; daysLeft: number } | null;
    consultation?: RecoveryConsultation | null;
  };
  /** subscription.plan (solo la administración; null si no aplica). */
  contract?: {
    contract: { state: string; interval: "month" | "year"; recurringNetCents: number | null; currency: string; graceEndsAt: number | null } | null;
    period: { renewsAt: number | null; cancelAt: number | null } | null;
    billing: { status: string | null; cancelAtPeriodEnd: boolean };
    customTerms?: { contracting?: ContractingInput | null; current?: { interval?: "month" | "year" } | null } | null;
  } | null;
  isAdmin: boolean;
  portalEnabled: boolean;
  conversionEnabled: boolean;
  /** Hay planes publicados que comparar (#planes). */
  hasPlans: boolean;
}

const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
const days = (n: number) => (n === 1 ? "Te queda 1 día" : `Te quedan ${n} días`);

/** Panel de la contratación formalizada; null si no consta un acuerdo aceptado (la presentación comercial no cambia). */
export function contractedPanel(c: ContractingInput | null | undefined, trialEnd: number | null, trialPlanName: string, interval: "month" | "year" = "month"): ContractedPanel | null {
  if (!c || c.acceptedAt === null) return null;
  const per = interval === "year" ? "al año" : "al mes";
  const confirmations: ContractedPanel["confirmations"] = [{ id: "formalized", label: `Contratación formalizada el ${formatConsultDate(c.acceptedAt)}`, tone: "success" }];
  confirmations.push(
    c.paymentMethodAuthorized
      ? { id: "payment_method", label: "Método de pago registrado y confirmado por Stripe", tone: "success" }
      : { id: "payment_method", label: "Método de pago pendiente de autorizar", tone: "warning" },
  );
  const fee = c.recurring ? { label: "Cuota pactada", value: `${money(c.recurring.netCents, c.recurring.currency)} + IVA ${per} (${money(c.recurring.totalCents, c.recurring.currency)} con IVA)` } : null;
  const endsAt = trialEnd ?? c.trialEndsAt;
  const firstCharge =
    c.paymentMethodAuthorized && c.nextChargeAt && c.recurring
      ? { label: "Primer cobro previsto", value: `${formatConsultDate(c.nextChargeAt)} · ${money(c.recurring.totalCents, c.recurring.currency)} con IVA`, note: "Todavía no se ha cobrado nada: es la fecha y el importe previstos." }
      : null;
  const target = [c.planName, ...c.extensions].filter(Boolean).join(" + ") || "tu plan contratado";
  const afterTrial = c.paymentMethodAuthorized
    ? `Al terminar la prueba${endsAt ? ` (${formatConsultDate(endsAt)})` : ""}, tu cuenta pasa del plan ${trialPlanName} a ${target} y se hace el primer cobro con el método de pago registrado. No tienes que hacer nada.`
    : `Al terminar la prueba${endsAt ? ` (${formatConsultDate(endsAt)})` : ""}, tu cuenta pasará del plan ${trialPlanName} a ${target}. Para que el cambio y el cobro se hagan sin interrupciones, falta autorizar el método de pago.`;
  return { title: "Plan contratado", planName: c.planName, extensions: c.extensions, confirmations, fee, firstCharge, afterTrial };
}

export function subscriptionHeader(i: SubscriptionHeaderInput): SubscriptionHeaderModel {
  const o = i.overview;
  const contract = i.contract ?? null;
  const c = contract?.contract ?? null;
  const planName = o.plan?.name ?? "Sin plan asignado";
  const plansAction = (label: string): HeaderAction | null => (i.hasPlans ? { kind: "plans", label } : null);
  const portal: HeaderAction | null = i.portalEnabled ? { kind: "portal", label: "Facturas y método de pago" } : null;
  const recovery = resolveRecovery({ overview: o, contract, isAdmin: i.isAdmin, portalEnabled: i.portalEnabled, conversionEnabled: i.conversionEnabled });
  const amountFact: HeaderFact | null =
    c && c.recurringNetCents !== null ? { id: "amount", label: c.interval === "year" ? "Importe anual" : "Importe mensual", value: `${money(c.recurringNetCents, c.currency)} + IVA` } : null;

  // 1) Pago pendiente o fallido (manda sobre la suspensión, que suele ser su consecuencia)
  if (recovery?.kind === "payment_pending" && isPaymentPending(contract)) {
    const facts: HeaderFact[] = [{ id: "payment", label: "Cobro", value: c?.state === "suspended" ? "Suspendida por impago" : "Pago pendiente", tone: "warning" }];
    if (c?.graceEndsAt) facts.push({ id: "grace", label: "Regulariza antes del", value: formatConsultDate(c.graceEndsAt), tone: "warning" });
    if (amountFact) facts.push(amountFact);
    return {
      eyebrow: "Tu plan actual",
      planName,
      status: { label: recovery.readOnly ? "Pendiente de pago" : "Pago pendiente", tone: "warning" },
      facts,
      dataNote: recovery.text,
      restriction: recovery.secondary || null,
      primary: !i.isAdmin ? null : i.portalEnabled ? { kind: "portal", label: "Actualizar el pago" } : { kind: "billing", label: "Ver el estado del cobro" },
      secondary: i.isAdmin && !i.portalEnabled ? null : plansAction("Ver planes"),
    };
  }

  switch (o.state) {
    case "trial": {
      const t = o.trial;
      const facts: HeaderFact[] = t ? [{ id: "trial", label: days(Math.max(t.daysLeft, 0)), value: `hasta el ${formatConsultDate(t.endsAt)}` }] : [];
      // Contratación ya formalizada durante la prueba: se muestra por separado y no se invita a contratar de nuevo
      const contracted = contractedPanel(contract?.customTerms?.contracting, t?.endsAt ?? null, planName, contract?.customTerms?.current?.interval ?? "month");
      if (contracted) {
        return {
          eyebrow: "Plan en prueba",
          planName,
          status: { label: "Prueba gratuita activa", tone: "info" },
          facts,
          dataNote: "No se te ha cobrado nada todavía. Tu contratación ya está formalizada: no hace falta que contrates de nuevo.",
          restriction: null,
          primary: plansAction("Ver la comparación de planes"),
          secondary: null,
          contracted,
        };
      }
      return {
        eyebrow: "Plan en prueba",
        planName,
        status: { label: "Prueba gratuita activa", tone: "info" },
        facts,
        dataNote: "No es una suscripción de pago y no se te ha cobrado nada. Al contratar se conserva todo lo que has preparado durante la prueba.",
        restriction: null,
        primary: i.isAdmin && i.conversionEnabled ? { kind: "convert", label: "Contratar un plan" } : plansAction("Ver planes"),
        secondary: i.isAdmin && i.conversionEnabled ? plansAction("Comparar planes") : null,
      };
    }
    case "trial_expired": {
      const facts: HeaderFact[] = o.trial ? [{ id: "trial", label: "Terminó el", value: formatConsultDate(o.trial.endsAt) }] : [];
      // Acuerdo ya aceptado: el cambio al plan contratado lo aplica el sistema; no se pide contratar
      const contractedEnd = contractedPanel(contract?.customTerms?.contracting, o.trial?.endsAt ?? null, planName, contract?.customTerms?.current?.interval ?? "month");
      if (contractedEnd) {
        return {
          eyebrow: "Plan en prueba",
          planName,
          status: { label: "Prueba finalizada · activando tu plan contratado", tone: "info" },
          facts,
          dataNote: "Tu contratación está formalizada y se está aplicando. No tienes que contratar de nuevo.",
          restriction: null,
          primary: plansAction("Ver la comparación de planes"),
          secondary: null,
          contracted: contractedEnd,
        };
      }
      return {
        eyebrow: "Plan en prueba",
        planName,
        status: { label: "Prueba finalizada", tone: "warning" },
        facts,
        dataNote: "Contrata ahora y sigue donde lo dejaste: se conservan tus datos, usuarios y configuración.",
        restriction: recovery ? `${recovery.text} ${recovery.secondary}`.trim() : "La cuenta está en solo lectura hasta que contrates un plan.",
        primary: i.isAdmin ? (i.conversionEnabled ? { kind: "convert", label: "Contratar un plan" } : plansAction("Ver planes y contratar")) : null,
        secondary: i.isAdmin && i.conversionEnabled ? plansAction("Comparar planes") : null,
      };
    }
    case "active": {
      const period = contract?.period ?? null;
      // Cancelada con acceso vigente: la baja está programada para el fin del periodo pagado
      if (period?.cancelAt || c?.state === "cancel_scheduled") {
        const facts: HeaderFact[] = period?.cancelAt ? [{ id: "end", label: "Acceso hasta el", value: formatConsultDate(period.cancelAt), tone: "warning" }] : [];
        if (amountFact) facts.push(amountFact);
        return {
          eyebrow: "Tu plan actual",
          planName,
          status: { label: "Cancelada · acceso vigente", tone: "warning" },
          facts,
          dataNote: "Tu suscripción no se renovará. Hasta esa fecha sigues trabajando con normalidad y, después, tus datos se conservan.",
          restriction: null,
          // Mantenerla es cosa de la administración (deshacer la baja, solo la persona propietaria, en «Facturación y contrato»)
          primary: i.isAdmin ? { kind: "billing", label: "Mantener mi suscripción" } : plansAction("Comparar planes"),
          secondary: i.isAdmin ? (portal ?? plansAction("Comparar planes")) : null,
        };
      }
      const facts: HeaderFact[] = [];
      if (period?.renewsAt) facts.push({ id: "renewal", label: "Próxima renovación", value: formatConsultDate(period.renewsAt) });
      if (amountFact) facts.push(amountFact);
      if (c && c.state === "active") facts.push({ id: "payment", label: "Cobro", value: "Al corriente", tone: "success" });
      return {
        eyebrow: "Tu plan actual",
        planName,
        status: { label: "Suscripción activa", tone: "success" },
        facts,
        dataNote: null,
        restriction: null,
        primary: plansAction("Comparar planes"),
        secondary: portal,
      };
    }
    case "read_only":
    case "cancelled":
      return {
        eyebrow: "Tu plan anterior",
        planName,
        status: { label: o.state === "cancelled" ? "Cancelada" : "Finalizada", tone: "warning" },
        facts: [],
        dataNote: subscriptionEndedText(o.consultation),
        restriction: recovery?.secondary || null,
        primary: i.isAdmin ? plansAction("Reactivar mi plan") : null,
        secondary: portal,
      };
    case "suspended":
      return {
        eyebrow: "Tu plan actual",
        planName,
        status: { label: "Restringida temporalmente", tone: "danger" },
        facts: [],
        dataNote: recovery?.text ?? null,
        restriction: recovery?.secondary || null,
        primary: { kind: "link", label: "Contactar con soporte", href: SUPPORT_HREF },
        secondary: portal,
      };
    case "pending":
      return {
        eyebrow: "Tu plan actual",
        planName,
        status: { label: "Pendiente de activar", tone: "info" },
        facts: amountFact ? [amountFact] : [],
        dataNote: "Tu contratación está registrada y estamos activando tu plan. No tienes que hacer nada más.",
        restriction: null,
        primary: plansAction("Ver planes"),
        secondary: portal,
      };
    default:
      return {
        eyebrow: "Tu plan actual",
        planName,
        status: { label: "Sin plan activo", tone: "neutral" },
        facts: [],
        dataNote: null,
        restriction: null,
        primary: i.isAdmin ? plansAction("Ver planes") : null,
        secondary: portal,
      };
  }
}
