/**
 * Doble de Stripe para el cobro de condiciones personalizadas: sin red ni claves. Imita lo que importa del
 * comportamiento real: la misma Idempotency-Key devuelve el mismo resultado sin repetir el efecto, otra petición con
 * la misma clave y otros parámetros falla, y se puede simular una caída ANTES o DESPUÉS de aplicar el efecto (la
 * respuesta se pierde pero Stripe sí lo aplicó). Registra cada llamada. No existe ninguna operación sobre Prices.
 */
import type { NegotiatedBillingGateway, NegotiatedItem, NegotiatedOneOff } from "./billing";

export class FakeNegotiatedGateway implements NegotiatedBillingGateway {
  calls: Array<{ op: "applyItems" | "addOneOff" | "current"; key?: string; input?: unknown }> = [];
  /** Partidas recurrentes de cada suscripción de Stripe. */
  items = new Map<string, NegotiatedItem[]>();
  /** Importes únicos pendientes de la próxima factura de cada suscripción. */
  oneOffs = new Map<string, NegotiatedOneOff[]>();
  /** Fallos programados, en orden: «before» falla sin aplicar; «after» aplica y pierde la respuesta. */
  failures: Array<"before" | "after"> = [];
  private idem = new Map<string, { params: string; ref: string }>();
  private seq = 0;

  private run(key: string, input: unknown, effect: () => void): { ref: string } {
    const params = JSON.stringify(input);
    const prev = this.idem.get(key);
    if (prev) {
      if (prev.params !== params) throw new Error("Stripe respondió 400 (idempotency_error)");
      return { ref: prev.ref };
    }
    const fail = this.failures.shift();
    if (fail === "before") throw new Error("Stripe no responde (error de red)");
    effect();
    const ref = `neg_test_${String(++this.seq).padStart(6, "0")}`;
    this.idem.set(key, { params, ref });
    if (fail === "after") throw new Error("Stripe no responde (se perdió la respuesta)");
    return { ref };
  }

  async applyItems(input: { subscriptionId: string; currency: string; items: NegotiatedItem[]; metadata: Record<string, string> }, key: string) {
    this.calls.push({ op: "applyItems", key, input });
    return this.run(key, input, () => this.items.set(input.subscriptionId, input.items.map((i) => ({ ...i }))));
  }
  async addOneOff(input: { subscriptionId: string; customerId: string; currency: string; item: NegotiatedOneOff; metadata: Record<string, string> }, key: string) {
    this.calls.push({ op: "addOneOff", key, input });
    return this.run(key, input, () => this.oneOffs.set(input.subscriptionId, [...(this.oneOffs.get(input.subscriptionId) ?? []), { ...input.item }]));
  }
  async current(subscriptionId: string) {
    this.calls.push({ op: "current", input: subscriptionId });
    const items = this.items.get(subscriptionId);
    return items ? { items: items.map((i) => ({ key: i.key, amountCents: i.amountCents, interval: i.interval, taxRateBp: i.taxRateBp })) } : null;
  }
  /** Importe que Stripe cobraría en la próxima factura: recurrentes más importes únicos pendientes, por tipo de impuesto. */
  nextInvoice(subscriptionId: string) {
    const lines = [...(this.items.get(subscriptionId) ?? []), ...(this.oneOffs.get(subscriptionId) ?? [])];
    const rates = Array.from(new Set(lines.map((l) => l.taxRateBp)));
    const netCents = lines.reduce((a, l) => a + l.amountCents, 0);
    const taxCents = rates.reduce((a, r) => a + Math.round((lines.filter((l) => l.taxRateBp === r).reduce((x, l) => x + l.amountCents, 0) * r) / 10_000), 0);
    return { netCents, taxCents, totalCents: netCents + taxCents, lines: lines.length };
  }
}
