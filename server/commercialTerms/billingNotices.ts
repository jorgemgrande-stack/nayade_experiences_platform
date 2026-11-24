/**
 * Avisos internos a Dirección (administracion@bigelephant.es) de la vida comercial de una contratación con
 * condiciones personalizadas: contrato aceptado, método de pago confirmado, primer cobro real, cobro recurrente,
 * pago fallido o que requiere intervención, y cancelación, reembolso o disputa.
 *
 * Reglas:
 *  - Solo lectura y solo correo: nunca cambia estados económicos ni lanza (un fallo del correo no frena el procesamiento).
 *  - «Cobro confirmado» únicamente con una factura PAGADA de importe mayor que cero (una prueba gratuita, una factura de
 *    0 € o una autorización de tarjeta no son un cobro y nunca se anuncian como tal).
 *  - Idempotente por hecho de negocio: la clave identifica el hecho (factura, suscripción de Stripe, aceptación…), no el
 *    evento que lo trae; el gestor de correo no repite una clave ya enviada (reenvíos de Stripe, conciliaciones, reintentos).
 *  - Los hechos históricos no se reenvían: solo se avisa cuando el hecho se registra por primera vez.
 */
import { opsLog } from "../_core/ops/log";
import type { BillingPlan } from "./billing";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type BillingNoticeKind = "contract_accepted" | "method_confirmed" | "first_charge" | "recurring_charge" | "payment_failed" | "cancellation" | "refund_or_dispute";

export interface BillingNoticeEvent {
  kind: BillingNoticeKind;
  /** Clave del hecho de negocio (sin prefijo): `invoice:in_…`, `terms:7:accepted:3`, `stripe:sub_…:failed:past_due`… */
  key: string;
  subscriptionId: number | null;
  /** Ocurrió (ms). */
  at: number;
  stripeStatus?: string | null;
  /** Fin de la prueba (ms), si Stripe la tiene en curso. */
  trialEnd?: number | null;
  invoice?: { id: string; number: string | null; subtotalCents: number | null; taxCents: number | null; totalCents: number | null; amountPaidCents: number; currency: string } | null;
  detail?: string | null;
}

export interface BillingNoticeDeps {
  subscriptions: { get(id: number): Promise<{ id: number; reference?: string | null; companyId: number; tenantId: string | null; contractId: number | null; status: string; interval?: string } | null> };
  crmStore: { get(entity: string, id: number): Promise<Row | null> };
  billing: { plan(subscriptionId: number): Promise<BillingPlan> };
  /** Envía el correo (clave ya con prefijo). Devuelve sin lanzar. */
  send: (key: string, title: string, lines: string[]) => Promise<unknown>;
  /** Base del CRM central (por defecto https://admin.bigelephant.es/). */
  crmUrl?: string;
}

const LABEL: Record<BillingNoticeKind, string> = {
  contract_accepted: "Contrato aceptado y contratación formalizada",
  method_confirmed: "Método de pago confirmado (sin cobro todavía)",
  first_charge: "Primer cobro real confirmado",
  recurring_charge: "Cobro recurrente confirmado",
  payment_failed: "Pago fallido: requiere intervención",
  cancellation: "Cancelación de la suscripción",
  refund_or_dispute: "Reembolso o disputa de un cobro",
};
const STRIPE_STATUS: Record<string, string> = {
  trialing: "En prueba gratuita (Stripe no ha cobrado todavía)",
  active: "Activa y al corriente",
  past_due: "Pago fallido: Stripe reintenta el cobro",
  unpaid: "Impagada",
  canceled: "Cancelada",
  incomplete: "Pago incompleto",
  incomplete_expired: "Pago caducado sin completarse",
  paused: "En pausa",
};
const ACTION: Partial<Record<BillingNoticeKind, string>> = {
  payment_failed: "Revisar el expediente y contactar con el cliente para actualizar su método de pago. Stripe reintenta el cobro según su política; el servicio no se suspende automáticamente por este aviso.",
  refund_or_dispute: "Revisar el cargo en Stripe y decidir si el acceso debe mantenerse. Una disputa perdida o un reembolso total retiene el acceso en el CRM.",
  cancellation: "Confirmar con el cliente el fin del servicio y revisar si queda algún importe pendiente.",
};

const madrid = (ms: number) => new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" }).format(new Date(ms));
const day = (ms: number) => new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long" }).format(new Date(ms));
const eur = (cents: number, currency = "EUR") => new Intl.NumberFormat("es-ES", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

/** ¿El aviso afirma un cobro? Solo se envía con evidencia: factura pagada de importe > 0. */
export const claimsCharge = (k: BillingNoticeKind) => k === "first_charge" || k === "recurring_charge";

export function createBillingNotifier(d: BillingNoticeDeps): (e: BillingNoticeEvent) => Promise<void> {
  const base = (d.crmUrl ?? "https://admin.bigelephant.es/").replace(/#.*$/, "");
  return async (e) => {
    try {
      if (claimsCharge(e.kind) && !((e.invoice?.amountPaidCents ?? 0) > 0)) {
        opsLog("warn", "BillingNotice", "skipped_no_charge_evidence", { kind: e.kind, subscriptionId: e.subscriptionId });
        return;
      }
      const sub = e.subscriptionId !== null ? await d.subscriptions.get(e.subscriptionId) : null;
      const company = sub ? await d.crmStore.get("companies", sub.companyId) : null;
      const contract = sub?.contractId ? await d.crmStore.get("contracts", sub.contractId) : null;
      const plan = sub ? await d.billing.plan(sub.id).catch(() => null) : null;
      const lines: string[] = [];
      lines.push(`Acontecimiento: ${LABEL[e.kind]}.`);
      lines.push(`Fecha y hora (España): ${madrid(e.at)}.`);
      lines.push(`Empresa: ${company?.name ?? "—"}${sub ? ` (n.º ${sub.companyId})` : ""}.`);
      lines.push(`Contrato: ${contract?.reference ?? "—"} · Suscripción: ${sub?.reference ?? (sub ? `#${sub.id}` : "—")}.`);
      if (plan?.items.length) {
        lines.push(`Plan y servicios: ${plan.items.map((i) => i.name).join(", ")}.`);
        const net = plan.recurringNetCents;
        const tax = Math.round(plan.items.reduce((a, i) => a + (i.amountCents * i.taxRateBp) / 10000, 0));
        lines.push(`Cuota contratada: ${eur(net, plan.currency)} + IVA ${eur(tax, plan.currency)} = ${eur(net + tax, plan.currency)} (${sub?.interval === "year" ? "anual" : "mensual"}).`);
      }
      if (e.invoice && claimsCharge(e.kind)) {
        const i = e.invoice;
        lines.push(`Importe efectivamente cobrado: ${eur(i.amountPaidCents, i.currency)}${i.taxCents != null && i.subtotalCents != null ? ` (base ${eur(i.subtotalCents, i.currency)} + IVA ${eur(i.taxCents, i.currency)})` : ""} · moneda ${i.currency.toUpperCase()} · factura ${i.number ?? i.id}.`);
      }
      if (e.stripeStatus) lines.push(`Estado de la suscripción: ${STRIPE_STATUS[e.stripeStatus] ?? e.stripeStatus}${e.stripeStatus === "trialing" && e.trialEnd ? `; primer cobro previsto el ${day(e.trialEnd)}` : ""}.`);
      else if (sub) lines.push(`Estado de la suscripción: ${sub.status === "active" ? "activa" : sub.status}.`);
      const tenant = sub?.tenantId ?? company?.tenantId ?? null;
      lines.push(`Estado de la plataforma: ${tenant ? `activa (${tenant})` : "pendiente de alta"}.`);
      if (e.detail) lines.push(e.detail);
      const action = ACTION[e.kind] ?? (e.kind === "contract_accepted" && !tenant ? "Esperar el método de pago del cliente: hasta entonces no hay cobro ni plataforma." : e.kind === "first_charge" && !tenant ? "Comprobar que la plataforma se da de alta (si falta un contacto administrador, añadirlo en la ficha de la empresa)." : null);
      lines.push(`Acción requerida: ${action ?? "ninguna."}`);
      if (sub) lines.push(`Expediente en el CRM central: ${base}#/comercial/suscripciones/${sub.id}`);
      const title = `${LABEL[e.kind]} · ${company?.name ?? "empresa"}${sub?.reference ? ` · ${sub.reference}` : ""}`;
      await d.send(`${e.kind}:${e.key}`, title, lines);
    } catch (err) {
      opsLog("warn", "BillingNotice", "failed", { kind: e.kind, subscriptionId: e.subscriptionId, error: err instanceof Error ? err.name : "error" });
    }
  };
}
