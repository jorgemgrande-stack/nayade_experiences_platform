/**
 * Facturación en MODO SOMBRA: calcula, registra y compara. Nunca cobra ni emite facturas fiscales.
 *
 * Para el periodo vigente [S, E) de una suscripción:
 *  - renewal:   partidas recurrentes vigentes en S, con su precio CONTRATADO (instantánea). Con
 *               intervalos mixtos, las partidas de periodicidad más corta que el Core (mensuales en
 *               un plan anual) renuevan aparte en cada uno de SUS periodos ya empezados (concepto
 *               `interval:month`, con el periodo propio);
 *  - proration: partidas recurrentes que empiezan dentro de SU periodo (alta o subida a mitad), por la
 *               fracción restante de ese periodo; en una subida de plan se descuenta la parte no
 *               consumida del plan anterior. Nunca negativo (sin abonos, D-S3);
 *  - one_time:  servicios de pago único que empiezan en el periodo;
 *  - usage:     consumos del periodo, solo cuando el periodo ha terminado (no se factura a medias).
 * Cada factura es única por (suscripción, tipo, periodo, concepto): repetir la simulación devuelve la
 * misma, sin duplicar. Si el recálculo no coincide con lo registrado, se informa (`drift`).
 */
import type { CrmPort } from "./ports";
import { coverage, intervalMonths, isRecurring, itemInterval, itemPeriodAt, itemPeriods, lineAmounts, recurringKind, stableHash } from "./pricing";
import type { SubscriptionStore } from "./store";
import { SubscriptionError, type ShadowInvoice, type ShadowInvoiceKind, type ShadowLine, type Subscription, type SubscriptionItem } from "./types";

type Draft = Omit<ShadowInvoice, "id">;

function line(item: SubscriptionItem, at: number, fraction: number, description: string, sign = 1, quantity?: number): ShadowLine {
  const a = lineAmounts(item, at, fraction, quantity);
  return {
    itemId: item.id,
    productKey: item.productKey,
    productName: item.productName,
    family: item.family,
    priceId: item.priceId,
    description,
    quantity: quantity ?? item.quantity,
    unitAmountCents: item.unitAmountCents,
    fraction: Math.round(fraction * 1e6) / 1e6,
    grossCents: sign * a.grossCents,
    discountCents: sign * a.discountCents,
    netCents: sign * a.netCents,
    taxRateBp: item.taxRateBp,
    taxCents: sign * a.taxCents,
    totalCents: sign * a.totalCents,
  };
}

/** Lo que entra en el cálculo: si es igual, el resultado es igual (huella). */
const itemInput = (i: SubscriptionItem) => ({
  id: i.id,
  priceId: i.priceId,
  unit: i.unitAmountCents,
  qty: i.quantity,
  tax: [i.taxRateBp, i.taxIncluded],
  disc: i.discount,
  from: i.effectiveFrom,
  to: i.effectiveTo,
});

export class ShadowBillingService {
  private now: () => number;
  constructor(private d: { store: SubscriptionStore; crm: CrmPort; now?: () => number }) {
    this.now = d.now ?? Date.now;
  }

  /** Cálculo puro de las facturas sombra del periodo vigente (sin registrar nada). */
  async compute(sub: Subscription, actor = "shadow"): Promise<{ drafts: Draft[]; pending: string[] }> {
    const S = sub.currentPeriodStart;
    const E = sub.currentPeriodEnd;
    const items = await this.d.store.items(sub.id);
    const drafts: Draft[] = [];
    const pending: string[] = [];
    if (sub.status === "canceled") return { drafts, pending: ["Suscripción cancelada: no hay periodo que calcular"] };
    // Durante la prueba solo se factura la parte del periodo posterior a su fin
    const billable = sub.trialEnd !== null && sub.trialEnd > S ? coverage(S, E, sub.trialEnd, null) : 1;
    const contract = sub.contractId ? await this.d.crm.contract(sub.contractId) : null;
    const make = (kind: ShadowInvoiceKind, dedupeKey: string, lines: ShadowLine[], input: unknown, period = { start: S, end: E }): Draft => {
      const sum = (k: keyof ShadowLine) => lines.reduce((a, l) => a + (l[k] as number), 0);
      let subtotal = sum("grossCents");
      let discount = sum("discountCents");
      let tax = sum("taxCents");
      let total = sum("totalCents");
      if (total < 0) [subtotal, discount, tax, total] = [0, 0, 0, 0]; // sin abonos (D-S3)
      // Comparación con el contrato: base imponible del periodo frente al importe pactado
      const compare = kind === "renewal" && dedupeKey === "" && contract?.amountCents != null && contract.billingInterval === sub.interval && contract.currency === sub.currency;
      return {
        subscriptionId: sub.id,
        kind,
        periodStart: period.start,
        periodEnd: period.end,
        dedupeKey,
        currency: sub.currency,
        subtotalCents: subtotal,
        discountCents: discount,
        taxCents: tax,
        totalCents: total,
        lines,
        inputHash: stableHash({ kind, S: period.start, E: period.end, billable, input }),
        contractAmountCents: compare ? contract!.amountCents : null,
        contractDiffCents: compare ? subtotal - discount - contract!.amountCents! : null,
        paymentStatus: "none",
        createdAt: this.now(),
        createdBy: actor,
      };
    };

    // Renovación: lo vigente al inicio del periodo, con el tipo de precio de la periodicidad actual
    const renewing = items.filter((i) => isRecurring(i.priceKind) && i.priceKind === recurringKind(sub.interval) && i.effectiveFrom <= S && (i.effectiveTo === null || i.effectiveTo > S));
    if (renewing.length && billable > 0) {
      drafts.push(make("renewal", "", renewing.map((i) => line(i, S, billable, `${i.productName} · periodo completo`)), renewing.map(itemInput)));
    } else if (billable === 0) {
      pending.push("Periodo íntegramente en prueba: sin importe");
    }

    // Intervalos mixtos: las partidas de periodicidad más corta que el Core renuevan en cada uno de
    // sus periodos ya empezados, con su propio periodo y concepto
    if (intervalMonths(sub.interval) > 1) {
      for (const p of itemPeriods(sub, "month").filter((x) => x.start <= this.now())) {
        const monthly = items.filter((i) => i.priceKind === "monthly" && i.effectiveFrom <= p.start && (i.effectiveTo === null || i.effectiveTo > p.start));
        const part = sub.trialEnd !== null && sub.trialEnd > p.start ? coverage(p.start, p.end, sub.trialEnd, null) : 1;
        if (!monthly.length || part === 0) continue;
        drafts.push(make("renewal", "interval:month", monthly.map((i) => line(i, p.start, part, `${i.productName} · periodo mensual`)), { part, items: monthly.map(itemInput) }, p));
      }
    }

    // Prorrateos: recurrentes que empiezan dentro de SU periodo (no en una renovación suya)
    for (const i of items.filter((x) => isRecurring(x.priceKind) && x.effectiveFrom > S && x.effectiveFrom < E)) {
      const own = itemPeriodAt(sub, itemInterval(i.priceKind)!, i.effectiveFrom);
      if (i.effectiveFrom <= own.start) continue;
      // Fracción restante de su periodo (sin la parte en prueba)
      const frac = coverage(own.start, own.end, Math.max(i.effectiveFrom, sub.trialEnd ?? 0), i.effectiveTo);
      const lines = [line(i, i.effectiveFrom, frac, `${i.productName} · alta a mitad de periodo`)];
      const inputs = [itemInput(i)];
      // Subida de plan: se descuenta la parte no consumida del plan que se cobró en la renovación
      if (i.family === "core_plan") {
        const prev = items.find((p) => p.family === "core_plan" && p.id !== i.id && p.effectiveTo === i.effectiveFrom && p.effectiveFrom <= S);
        if (prev) {
          lines.push(line(prev, i.effectiveFrom, coverage(S, E, i.effectiveFrom, null) * billable, `${prev.productName} · parte no consumida`, -1));
          inputs.push(itemInput(prev));
        }
      }
      drafts.push(make("proration", `item:${i.id}`, lines, inputs, own));
    }

    // Servicios de pago único
    for (const i of items.filter((x) => x.priceKind === "one_time" && x.effectiveFrom >= S && x.effectiveFrom < E)) {
      drafts.push(make("one_time", `item:${i.id}`, [line(i, i.effectiveFrom, 1, `${i.productName} · servicio`)], [itemInput(i)]));
    }

    // Consumos: solo con el periodo cerrado
    const usageItems = items.filter((x) => x.priceKind === "usage" && x.effectiveFrom < E && (x.effectiveTo === null || x.effectiveTo > S));
    if (usageItems.length) {
      if (this.now() < E) pending.push("Consumos: el periodo no ha terminado; se calculan al cerrarse");
      else {
        const lines: ShadowLine[] = [];
        const inputs: unknown[] = [];
        for (const i of usageItems) {
          const qty = await this.d.store.usageTotal(i.id, S);
          lines.push(line(i, S, 1, `${i.productName} · ${qty} ${i.unit ?? "unidades"}`, 1, qty));
          inputs.push({ ...itemInput(i), qty });
        }
        drafts.push(make("usage", "", lines, inputs));
      }
    }
    return { drafts, pending };
  }

  /** Calcula y REGISTRA el periodo vigente. Idempotente. */
  async simulateCurrent(subscriptionId: number, actor: string) {
    const sub = await this.d.store.get(subscriptionId);
    if (!sub) throw new SubscriptionError("not_found", "Suscripción no encontrada");
    const { drafts, pending } = await this.compute(sub, actor);
    if (sub.status !== "canceled" && this.now() >= sub.currentPeriodEnd) pending.push("El periodo vigente ya terminó: aplica las renovaciones para calcular el siguiente");
    const results = [];
    for (const dft of drafts) {
      const { invoice, created } = await this.d.store.recordShadowInvoice(dft);
      results.push({ invoice, created, drift: !created && invoice.inputHash !== dft.inputHash ? { recalculatedTotalCents: dft.totalCents } : null });
    }
    return { subscription: sub, results, pending };
  }

  /** Vista previa sin registrar (p. ej. qué se calcularía hoy). */
  async preview(subscriptionId: number) {
    const sub = await this.d.store.get(subscriptionId);
    if (!sub) throw new SubscriptionError("not_found", "Suscripción no encontrada");
    return this.compute(sub, "preview");
  }
}
