/**
 * Evaluación del DESISTIMIENTO de un consumidor (TRLGDCU art. 102-108; Directiva 2011/83/UE; función de
 * desistimiento de la Directiva (UE) 2023/2673). Pura: recibe los hechos y devuelve la evaluación. No decide
 * la resolución ni ejecuta nada (reembolsos o bajas los decide y ejecuta una persona con la política aprobada).
 *
 *  - Solo PARTICULARES con un contrato DE PAGO. Empresas y profesionales: no hay desistimiento legal (cancelación
 *    ordinaria). Prueba gratuita sin contrato de pago: no aplica (basta con no contratar).
 *  - Plazo: 14 días naturales desde la celebración del contrato (servicios), hasta el FINAL del día 14 en hora de
 *    Madrid. Si no consta que se facilitó la información precontractual sobre el desistimiento, el plazo se amplía
 *    12 meses (art. 105).
 *  - Ejecución inmediata: si el particular la pidió expresamente (casilla propia) y desiste, abona la parte
 *    proporcional del servicio prestado hasta que comunica el desistimiento (art. 108.3). Sin esa petición, se le
 *    devolvería todo. El cálculo es una PROPUESTA para la revisión, nunca un reembolso.
 *  - Excepción del art. 103.a (servicio completamente ejecutado con consentimiento y reconocimiento previos): en una
 *    suscripción mensual o anual no se produce dentro del plazo; se marca por si el periodo ya hubiera terminado.
 */
import type { BuyerProfile } from "../stripe/buyerProfile";

export const WITHDRAWAL_DAYS = 14;
export const EXTENSION_MONTHS = 12;

export type WithdrawalApplicability = "applicable" | "not_consumer" | "no_paid_contract";

export interface WithdrawalFacts {
  /** Perfil fiscal del comprador del contrato (null si no consta). */
  buyer: Pick<BuyerProfile, "type" | "consent"> | null;
  /** Celebración del contrato de pago (confirmación del pedido de alta o de conversión); null si no hay. */
  contractAt: number | null;
  /** Lo cobrado en el periodo inicial (céntimos) y su moneda; null si no consta. */
  paid: { amountCents: number; currency: string } | null;
  /** Periodo inicial pagado (para la parte proporcional). */
  period: { start: number; end: number } | null;
}

export interface WithdrawalAssessment {
  applicability: WithdrawalApplicability;
  /** Fin del plazo (último instante del día 14, o del plazo ampliado), en ms. */
  deadlineAt: number | null;
  withinTerm: boolean;
  /** Plazo ampliado 12 meses por no constar la información precontractual. */
  extended: boolean;
  /** El particular pidió la ejecución inmediata (y reconoció el efecto sobre el desistimiento). */
  immediateExecution: boolean;
  /** Servicio completamente ejecutado (excepción del art. 103.a, solo con ejecución inmediata reconocida). */
  fullyPerformed: boolean;
  /** Propuesta: parte proporcional prestada y reembolso resultante (céntimos). Null sin datos de cobro. */
  proportionalCents: number | null;
  refundProposalCents: number | null;
  currency: string | null;
  /** Explicación breve en claro (para el justificante y la revisión). */
  summary: string;
}

const MADRID = "Europe/Madrid";
/** Fecha civil (año, mes, día) de un instante en Madrid. */
function madridDate(ms: number): { y: number; m: number; d: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: MADRID, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}
/** Desfase de Madrid respecto a UTC en un instante (minutos). */
function madridOffsetMin(ms: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: MADRID, timeZoneName: "shortOffset" }).formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName")!.value;
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}
/** Último milisegundo del día civil (y, m, d) en Madrid. Date.UTC normaliza desbordes de día y mes. */
export function endOfMadridDay(y: number, m: number, d: number): number {
  const guess = Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  const first = guess - madridOffsetMin(guess) * 60_000;
  return guess - madridOffsetMin(first) * 60_000;
}

/** Fin del plazo de desistimiento para un contrato celebrado en `contractAt` (con la ampliación si procede). */
export function withdrawalDeadline(contractAt: number, extended: boolean): number {
  const { y, m, d } = madridDate(contractAt);
  return extended ? endOfMadridDay(y, m + EXTENSION_MONTHS, d + WITHDRAWAL_DAYS) : endOfMadridDay(y, m, d + WITHDRAWAL_DAYS);
}

const eur = (c: number, cur: string) => `${(c / 100).toFixed(2).replace(".", ",")} ${cur.toUpperCase()}`;

export function assessWithdrawal(f: WithdrawalFacts, now: number): WithdrawalAssessment {
  const base = { deadlineAt: null, withinTerm: false, extended: false, immediateExecution: false, fullyPerformed: false, proportionalCents: null, refundProposalCents: null, currency: null };
  if (!f.buyer || f.buyer.type !== "consumer")
    return { ...base, applicability: "not_consumer", summary: "El desistimiento legal es un derecho de los particulares. Las empresas y profesionales cancelan la suscripción al final del periodo." };
  if (f.contractAt === null)
    return { ...base, applicability: "no_paid_contract", summary: "No hay un contrato de pago del que desistir (por ejemplo, una prueba gratuita): basta con no contratar o cancelar." };
  const extended = !f.buyer.consent.precontract;
  const deadlineAt = withdrawalDeadline(f.contractAt, extended);
  const withinTerm = now <= deadlineAt;
  const immediateExecution = !!f.buyer.consent.immediateExecution;
  const fullyPerformed = immediateExecution && !!f.period && now >= f.period.end;
  let proportionalCents: number | null = null;
  let refundProposalCents: number | null = null;
  if (f.paid) {
    if (immediateExecution && f.period && f.period.end > f.period.start) {
      const used = Math.min(Math.max(now - f.period.start, 0), f.period.end - f.period.start);
      proportionalCents = Math.round((f.paid.amountCents * used) / (f.period.end - f.period.start));
    } else proportionalCents = 0;
    refundProposalCents = fullyPerformed ? 0 : f.paid.amountCents - proportionalCents;
  }
  const money = f.paid && refundProposalCents !== null ? ` Propuesta de reembolso: ${eur(refundProposalCents, f.paid.currency)} de ${eur(f.paid.amountCents, f.paid.currency)}${immediateExecution ? " (descontada la parte prestada, por la ejecución inmediata solicitada)" : ""}.` : "";
  const term = withinTerm ? `Dentro del plazo (hasta el ${new Date(deadlineAt).toLocaleString("es-ES", { timeZone: MADRID })}${extended ? ", plazo ampliado por no constar la información precontractual" : ""}).` : `Fuera del plazo (terminó el ${new Date(deadlineAt).toLocaleString("es-ES", { timeZone: MADRID })}).`;
  return {
    applicability: "applicable",
    deadlineAt,
    withinTerm,
    extended,
    immediateExecution,
    fullyPerformed,
    proportionalCents,
    refundProposalCents,
    currency: f.paid?.currency ?? null,
    summary: `${term}${fullyPerformed ? " El servicio consta como completamente prestado con ejecución inmediata reconocida (art. 103.a): revisar." : ""}${money}`,
  };
}
