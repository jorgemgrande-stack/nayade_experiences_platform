/**
 * Importes de Elephant Net con Elephant Core incluido que se cobran DESPUÉS del alta (contrato v3 §5-§6). Módulo PURO.
 *
 *  - `contractualPrice`: la cuota contratada se reproduce desde la instantánea del pedido (tarifa completa − crédito
 *    de cada línea), nunca desde el catálogo publicado hoy. Una republicación de tarifas no cambia lo contratado.
 *  - `expectedChange` + `checkChangePreview`: un cambio a mitad de periodo (subida a Business, segundo Net) cobra
 *    `(P − crédito) × fracción`. Si la vista previa de Stripe calcula otra cosa (por ejemplo, el cupón entero en vez
 *    de prorrateado, riesgo R-J), el resultado es `conflict` y no se cobra: el cliente solo paga lo que acepta.
 * Importes en céntimos enteros, sin IVA.
 */
import type { CommercialLine } from "../catalog/commercial/commercialQuote";
import type { GwInvoicePreview } from "./gateway";
import { prorationCents } from "./multipart";

type SnapshotLine = Pick<CommercialLine, "key" | "interval" | "quantity" | "unitCents" | "status" | "credit">;

/** Cuota contratada por periodicidad, desde la instantánea del pedido (lo cobrado en cada renovación). */
export function contractualPrice(lines: SnapshotLine[]): { monthlyCents: number; yearlyCents: number; lines: Array<{ key: string; interval: "month" | "year"; grossCents: number; creditCents: number; netCents: number }> } {
  const out = lines
    .filter((l) => l.unitCents !== null && l.status !== "included_in_bundle" && l.status !== "included_in_net")
    .map((l) => {
      const credit = l.credit?.cents ?? 0;
      const gross = (l.unitCents! + credit) * l.quantity;
      return { key: l.key, interval: l.interval, grossCents: gross, creditCents: credit * l.quantity, netCents: gross - credit * l.quantity };
    });
  const sum = (i: "month" | "year") => out.filter((l) => l.interval === i).reduce((a, l) => a + l.netCents, 0);
  return { monthlyCents: sum("month"), yearlyCents: sum("year"), lines: out };
}

export interface ChangeItem {
  /** Precio de Stripe de la partida y su tarifa completa (sin IVA). */
  priceId: string;
  grossUnitCents: number;
  /** Crédito por partida (cupón), una vez por línea como en Stripe. */
  creditCents: number;
  from: number;
  to: number;
}

/** Neto esperado por partida de un cambio a mitad de periodo con el instante de prorrateo fijado. */
export function expectedChange(items: ChangeItem[], period: { start: number; end: number; at: number }) {
  const lines = items.map((i) => {
    const gross = prorationCents(i.grossUnitCents, i.from, i.to, period.start, period.end, period.at);
    const units = Math.sign(i.to - i.from);
    const credit = i.creditCents && units ? units * Math.abs(prorationCents(i.creditCents, 0, 1, period.start, period.end, period.at)) : 0;
    return { priceId: i.priceId, netCents: gross - credit };
  });
  return { lines, netCents: lines.reduce((a, l) => a + l.netCents, 0) };
}

/**
 * Compara la vista previa de Stripe con lo esperado: por precio (± 1 céntimo de redondeo por línea) y en total.
 * `ok: false` = no se cobra; se explica qué no coincide (para el `conflict` y la alerta).
 */
export function checkChangePreview(preview: Pick<GwInvoicePreview, "lines" | "subtotal" | "discountCents" | "totalExcludingTax">, expected: ReturnType<typeof expectedChange>): { ok: true; netCents: number } | { ok: false; reason: string } {
  const net = preview.discountCents ? (preview.totalExcludingTax ?? preview.subtotal - preview.discountCents) : preview.subtotal;
  const byPrice = new Map<string, number>();
  for (const l of preview.lines) if (l.priceId) byPrice.set(l.priceId, (byPrice.get(l.priceId) ?? 0) + l.amount - (l.discountCents ?? 0));
  for (const e of expected.lines) {
    const got = byPrice.get(e.priceId) ?? 0;
    if (Math.abs(got - e.netCents) > 1) return { ok: false, reason: `La partida ${e.priceId} se cobraría ${got} y se esperaba ${e.netCents} (céntimos, sin IVA)` };
  }
  if (Math.abs(net - expected.netCents) > expected.lines.length) return { ok: false, reason: `El cambio se cobraría ${net} y se esperaba ${expected.netCents} (céntimos, sin IVA)` };
  return { ok: true, netCents: net };
}
