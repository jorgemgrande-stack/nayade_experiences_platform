/**
 * Cobros SIMULADOS sobre facturas sombra. No hay ningún proveedor real conectado: `PaymentProvider`
 * es un puerto y aquí solo existe `SimulatedProvider` (en proceso, sin red).
 *
 * Corrige los riesgos del motor v1 (F2, F3, F8, F9, F11 de la fase 5):
 *  - Clave de idempotencia por intento LÓGICO (`inv:<factura>:a<n>`). Solo cambia tras un fallo
 *    DEFINITIVO del proveedor; un error de red, `processing` o `requires_action` no son fallos: el
 *    intento queda `unknown`/`processing` y se CONSULTA con la misma clave (nunca doble cargo).
 *  - Fase 1 (transacción con la factura bloqueada) registra el intento antes de llamar; fase 3 lo
 *    liquida. Dos procesos a la vez no crean dos intentos.
 *  - Una factura solo cuenta como pagada con un cobro `succeeded` confirmado.
 *  - Webhook: el evento se marca procesado en la MISMA transacción que su efecto; duplicados sin
 *    efecto; si el efecto falla, el evento queda `failed` y se reprocesa. Un pago sobre una
 *    suscripción cancelada no la reactiva: la factura pasa a `review`.
 */
import type { ChargeTx, SubscriptionStore } from "./store";
import { SubscriptionError, type ChargeStatus, type ShadowCharge } from "./types";

export type ProviderStatus = "succeeded" | "failed" | "processing" | "requires_action";
export interface PaymentProvider {
  /** Debe ser idempotente por clave. Puede lanzar (red): el resultado es entonces desconocido. */
  charge(key: string, amountCents: number, currency: string): Promise<{ status: ProviderStatus; ref: string }>;
  /** Estado de un cobro por clave; null si el proveedor nunca lo recibió. */
  lookup(key: string): Promise<{ status: ProviderStatus; ref: string } | null>;
}

/** Simulador en memoria con idempotencia real por clave y fallos inyectables (para pruebas y demo). */
export class SimulatedProvider implements PaymentProvider {
  private byKey = new Map<string, { status: ProviderStatus; ref: string; amountCents: number }>();
  /** Cargos realmente «ejecutados» (para comprobar que no hay dobles cargos). */
  executed: Array<{ key: string; amountCents: number }> = [];
  private script: Array<"succeeded" | "failed" | "processing" | "requires_action" | "network_error_after" | "network_error_before"> = [];
  private seq = 0;

  /** Encola el comportamiento de las próximas llamadas a `charge`. */
  next(...behaviours: SimulatedProvider["script"]) {
    this.script.push(...behaviours);
    return this;
  }
  /** Cambia el estado de un cobro (como si el banco lo resolviera más tarde). */
  settle(key: string, status: ProviderStatus) {
    const c = this.byKey.get(key);
    if (c) this.byKey.set(key, { ...c, status });
  }
  async charge(key: string, amountCents: number) {
    const existing = this.byKey.get(key);
    if (existing) return { status: existing.status, ref: existing.ref }; // idempotencia por clave
    const b = this.script.shift() ?? "succeeded";
    if (b === "network_error_before") throw new Error("ECONNRESET (simulado, antes de llegar)");
    const status: ProviderStatus = b === "network_error_after" ? "succeeded" : b;
    const ref = `sim_${++this.seq}`;
    this.byKey.set(key, { status, ref, amountCents });
    if (status === "succeeded") this.executed.push({ key, amountCents });
    if (b === "network_error_after") throw new Error("ETIMEDOUT (simulado, tras cobrar)");
    return { status, ref };
  }
  async lookup(key: string) {
    const c = this.byKey.get(key);
    return c ? { status: c.status, ref: c.ref } : null;
  }
}

const keyFor = (invoiceId: number, attempt: number) => `inv:${invoiceId}:a${attempt}`;
const OPEN: ChargeStatus[] = ["pending", "processing", "unknown"];

export type ChargeOutcome =
  | { kind: "already_paid"; charge: ShadowCharge }
  | { kind: "nothing_to_collect" }
  | { kind: "review"; reason: string }
  | { kind: "settled"; charge: ShadowCharge };

export class ShadowPaymentService {
  private now: () => number;
  constructor(private d: { store: SubscriptionStore; provider: PaymentProvider; now?: () => number }) {
    this.now = d.now ?? Date.now;
  }

  private async settle(tx: ChargeTx, charge: ShadowCharge, r: { status: ProviderStatus; ref: string } | { error: string }): Promise<ShadowCharge> {
    const at = this.now();
    if ("error" in r) {
      await tx.updateCharge(charge.id, { status: "unknown", error: r.error.slice(0, 200) });
      await tx.setPaymentStatus("pending");
      return { ...charge, status: "unknown", error: r.error.slice(0, 200) };
    }
    const status: ChargeStatus = r.status === "succeeded" ? "succeeded" : r.status === "failed" ? "failed" : "processing";
    if (status === "succeeded" && tx.subscriptionStatus === "canceled") {
      await tx.updateCharge(charge.id, { status, providerRef: r.ref, settledAt: at, error: null });
      await tx.setPaymentStatus("review"); // cobrado sobre una cancelada: revisión/reembolso manual
      return { ...charge, status, providerRef: r.ref, settledAt: at };
    }
    await tx.updateCharge(charge.id, { status, providerRef: r.ref, settledAt: status === "processing" ? null : at, error: null });
    await tx.setPaymentStatus(status === "succeeded" ? "paid" : status === "failed" ? "failed" : "pending");
    return { ...charge, status, providerRef: r.ref, settledAt: status === "processing" ? null : at };
  }

  /** Intenta (o reintenta) el cobro SIMULADO de una factura sombra. */
  async attempt(invoiceId: number): Promise<ChargeOutcome> {
    // Fase 1: bajo bloqueo de la factura, decidir y registrar
    const plan = await this.d.store.chargeTx(invoiceId, async (tx) => {
      const paid = tx.charges.find((c) => c.status === "succeeded");
      if (paid) return { kind: "already_paid" as const, charge: paid };
      if (tx.invoice.totalCents <= 0) return { kind: "nothing_to_collect" as const };
      if (tx.subscriptionStatus === "canceled") {
        await tx.setPaymentStatus("review");
        return { kind: "review" as const, reason: "Suscripción cancelada: no se cobra" };
      }
      const last = tx.charges[tx.charges.length - 1];
      if (last && OPEN.includes(last.status)) return { kind: "lookup" as const, charge: last }; // misma clave
      const attempt = (last?.attempt ?? 0) + 1;
      const charge = await tx.insertCharge({ invoiceId, idempotencyKey: keyFor(invoiceId, attempt), attempt, status: "pending", providerRef: null, error: null, createdAt: this.now(), settledAt: null });
      await tx.setPaymentStatus("pending");
      return { kind: "charge" as const, charge };
    });
    if (plan.kind !== "charge" && plan.kind !== "lookup") return plan;

    // Fase 2: proveedor (fuera de la transacción)
    let r: { status: ProviderStatus; ref: string } | { error: string };
    try {
      const inv = await this.invoiceTotal(invoiceId);
      // En la consulta, si el proveedor nunca lo recibió, reenviar con la MISMA clave es seguro
      const found = plan.kind === "lookup" ? await this.d.provider.lookup(plan.charge.idempotencyKey) : null;
      r = found ?? (await this.d.provider.charge(plan.charge.idempotencyKey, inv.total, inv.currency));
    } catch (e) {
      r = { error: (e as Error).message };
    }

    // Fase 3: liquidar bajo bloqueo (otro proceso puede haberlo liquidado ya)
    return this.d.store.chargeTx(invoiceId, async (tx) => {
      const cur = tx.charges.find((c) => c.id === plan.charge.id)!;
      if (cur.status === "succeeded" || cur.status === "failed") return { kind: "settled" as const, charge: cur };
      return { kind: "settled" as const, charge: await this.settle(tx, cur, r) };
    });
  }

  private async invoiceTotal(invoiceId: number) {
    const inv = await this.d.store.shadowInvoice(invoiceId);
    if (!inv) throw new SubscriptionError("not_found", "Factura sombra no encontrada");
    return { total: inv.totalCents, currency: inv.currency };
  }

  /** Webhook SIMULADO del proveedor: idempotente y transaccional con su efecto. */
  async webhook(event: { id: string; key: string; status: ProviderStatus; ref: string }) {
    return this.d.store.webhookTx(event.id, this.now(), async (lookup) => {
      const found = await lookup.byKey(event.key);
      if (!found) throw new SubscriptionError("not_found", "Cobro desconocido para esa clave");
      const { charge, tx } = found;
      // Un resultado definitivo no se pisa con eventos tardíos o desordenados
      if (charge.status === "succeeded" || (charge.status === "failed" && event.status !== "succeeded")) return { charge, ignored: true };
      return { charge: await this.settle(tx, charge, { status: event.status, ref: event.ref }), ignored: false };
    });
  }
}
