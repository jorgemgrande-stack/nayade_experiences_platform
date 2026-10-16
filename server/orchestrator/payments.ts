/**
 * Pagos del orquestador: SOLO MODO PRUEBAS, detrás de un puerto.
 *
 *  - No hay ningún proveedor real conectado. El adaptador de Stripe del motor anterior
 *    (`_core/billing/providers.ts`) cobra «off_session» a un cliente ya registrado y exige credenciales
 *    reales de pruebas que no existen en este entorno; no se reutiliza aquí. El proveedor disponible es
 *    `SignedTestProvider`: reutiliza `SimulatedProvider` (idempotencia por clave) y firma sus webhooks
 *    con HMAC-SHA256 (cabecera `t=<s>,v1=<hex>`, tiempo constante y tolerancia), como un proveedor real.
 *  - Nada cobra solo: no existe ningún cobro automático (`autoCharge` siempre false; pedirlo por
 *    configuración impide arrancar). Un pago se inicia con una acción explícita (checkout) y SOLO un
 *    evento firmado y verificado lo da por pagado.
 *  - Cualquier credencial «live» se rechaza.
 */
import crypto from "node:crypto";
import { SimulatedProvider } from "../subscriptions/shadowPayments";

export interface TestPaymentEvent {
  id: string;
  type: "payment.succeeded" | "payment.failed";
  /** Clave de idempotencia del pago al que se refiere. */
  paymentKey: string;
  providerRef: string;
  amountCents: number;
  currency: string;
  livemode: false;
  created: number;
}

export interface TestPaymentPort {
  readonly kind: string;
  readonly mode: "test";
  readonly autoCharge: false;
  /** Inicia un pago (checkout de pruebas). Idempotente por clave. No lo da por pagado. */
  checkout(input: { key: string; amountCents: number; currency: string; description: string }): Promise<{ providerRef: string }>;
  /** Verifica la firma y devuelve el evento; lanza `PaymentSignatureError` si no es auténtico. */
  verify(rawBody: string, signature: string, nowMs: number): TestPaymentEvent;
}

export class PaymentSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentSignatureError";
  }
}

const MIN_SECRET = 32;

export class SignedTestProvider implements TestPaymentPort {
  readonly kind = "simulated";
  readonly mode = "test" as const;
  readonly autoCharge = false as const;
  /** Simulador con idempotencia real por clave (sin red); se expone para inspección en pruebas. */
  readonly simulator = new SimulatedProvider();
  constructor(private o: { webhookSecret: string; toleranceSeconds?: number }) {
    if (!o.webhookSecret || o.webhookSecret.length < MIN_SECRET) throw new Error(`El secreto de webhooks de pruebas necesita al menos ${MIN_SECRET} caracteres`);
    if (/live/i.test(o.webhookSecret)) throw new Error("Solo se admiten secretos de pruebas");
  }

  async checkout(input: { key: string; amountCents: number; currency: string }) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Importe de pago no válido");
    // «processing»: el pago queda pendiente hasta el evento firmado del proveedor
    const existing = await this.simulator.lookup(input.key);
    const r = existing ?? (await this.simulator.next("processing").charge(input.key, input.amountCents));
    return { providerRef: r.ref };
  }

  /** Firma un evento como lo haría el proveedor (lo usan las pruebas y el simulador del entorno de pruebas). */
  sign(rawBody: string, atSeconds: number): string {
    const v1 = crypto.createHmac("sha256", this.o.webhookSecret).update(`${atSeconds}.${rawBody}`).digest("hex");
    return `t=${atSeconds},v1=${v1}`;
  }

  verify(rawBody: string, signature: string, nowMs: number): TestPaymentEvent {
    const parts = Object.fromEntries(
      String(signature)
        .split(",")
        .map((p) => {
          const i = p.indexOf("=");
          return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
        }),
    ) as Record<string, string>;
    const t = Number(parts.t);
    if (!parts.t || !parts.v1 || !Number.isInteger(t)) throw new PaymentSignatureError("Firma ausente o mal formada");
    if (Math.abs(nowMs / 1000 - t) > (this.o.toleranceSeconds ?? 300)) throw new PaymentSignatureError("Evento fuera de la ventana de tolerancia");
    const expected = Buffer.from(crypto.createHmac("sha256", this.o.webhookSecret).update(`${parts.t}.${rawBody}`).digest("hex"));
    const got = Buffer.from(parts.v1);
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) throw new PaymentSignatureError("Firma no válida");
    let ev: Partial<TestPaymentEvent>;
    try {
      ev = JSON.parse(rawBody);
    } catch {
      throw new PaymentSignatureError("Cuerpo no válido");
    }
    if (ev.livemode !== false) throw new PaymentSignatureError("Solo se aceptan eventos de pruebas (livemode: false)");
    if (typeof ev.id !== "string" || !/^[A-Za-z0-9_:.-]{4,120}$/.test(ev.id)) throw new PaymentSignatureError("Identificador de evento no válido");
    if (ev.type !== "payment.succeeded" && ev.type !== "payment.failed") throw new PaymentSignatureError("Tipo de evento no admitido");
    if (typeof ev.paymentKey !== "string" || typeof ev.providerRef !== "string" || !Number.isInteger(ev.amountCents) || typeof ev.currency !== "string") {
      throw new PaymentSignatureError("Evento incompleto");
    }
    return { id: ev.id, type: ev.type, paymentKey: ev.paymentKey, providerRef: ev.providerRef, amountCents: ev.amountCents!, currency: ev.currency.toUpperCase(), livemode: false, created: t };
  }
}

/**
 * Configuración desde el entorno. Sin `CP_PAYMENTS_TEST_WEBHOOK_SECRET` no hay pagos (null): los
 * pedidos solo se confirman por aprobación administrativa. Cobro automático: no existe.
 */
export function testPaymentsFromEnv(env: NodeJS.ProcessEnv = process.env): { provider: TestPaymentPort | null; reason: string | null } {
  if (["1", "true", "on"].includes((env.CP_PAYMENTS_AUTO_CHARGE ?? "").toLowerCase())) {
    throw new Error("CP_PAYMENTS_AUTO_CHARGE no está autorizado: el cobro automático está desactivado en esta fase");
  }
  const which = (env.CP_PAYMENTS_PROVIDER ?? "").toLowerCase();
  if (!which) return { provider: null, reason: "payments_not_configured" };
  if (which !== "simulated") throw new Error(`CP_PAYMENTS_PROVIDER=${which} no está soportado: solo «simulated» (modo pruebas)`);
  const secret = env.CP_PAYMENTS_TEST_WEBHOOK_SECRET ?? "";
  if (!secret) return { provider: null, reason: "missing_test_webhook_secret" };
  return { provider: new SignedTestProvider({ webhookSecret: secret }), reason: null };
}
