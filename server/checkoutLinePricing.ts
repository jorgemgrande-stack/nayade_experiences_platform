/**
 * Protección del cobro online: una línea de un producto de pago nunca se cobra a 0 € ni con un precio
 * desconocido. Adaptado de Skicenter (server/checkoutLinePricing.ts, 86731055).
 *
 * En Core el importe de la línea sale del precio base o del precio de la opción elegida (variante). Una opción
 * con precio fijo 0 (o sin configurar) daba 0 € y, en un carrito con más productos, esa línea se cobraba a 0 €
 * sin que nadie lo notara. Ahora la línea se bloquea con un mensaje claro y no se crea ninguna reserva ni cobro.
 */
import { TRPCError } from "@trpc/server";

export type LinePriceDecision = { ok: true; total: number } | { ok: false; reason: string };

export function decideCheckoutLinePrice(baseTotalEuros: number): LinePriceDecision {
  return Number.isFinite(baseTotalEuros) && baseTotalEuros > 0
    ? { ok: true, total: baseTotalEuros }
    : { ok: false, reason: `el importe calculado es ${baseTotalEuros} €` };
}

/** Mensaje para el cliente cuando no se puede calcular el precio de una línea. */
export function unpriceableLineMessage(productTitle: string): string {
  return `No hemos podido calcular el precio de «${productTitle}», así que no se ha realizado ningún cobro. Prueba con otra opción o contacta con nosotros.`;
}

/** Bloquea la línea (sin cobrar) si su importe sin extras no es > 0. */
export function assertCheckoutLinePriced(productTitle: string, baseTotalEuros: number, detail?: string): void {
  const decision = decideCheckoutLinePrice(baseTotalEuros);
  if (decision.ok) return;
  console.error(`[checkout] precio no calculable, línea bloqueada — «${productTitle}»${detail ? ` (${detail})` : ""}: ${decision.reason}`);
  throw new TRPCError({ code: "BAD_REQUEST", message: unpriceableLineMessage(productTitle) });
}
