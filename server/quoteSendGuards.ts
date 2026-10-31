import { TRPCError } from "@trpc/server";
import { findUnpricedCatalogLines, formatUnpricedLines, type UnpricedLineCandidate } from "../shared/quoteUnpricedLines";

/**
 * Un presupuesto NO se envía ni se reenvía con un producto del catálogo a 0,00 € por falta de precio
 * (ver shared/quoteUnpricedLines.ts). Aplica a enviar, reenviar y crear+enviar; el borrador sigue pudiendo
 * guardarse y editarse.
 */
export function assertQuotePricedForSend(items: unknown): void {
  const unpriced = findUnpricedCatalogLines(Array.isArray(items) ? (items as UnpricedLineCandidate[]) : []);
  if (unpriced.length > 0) throw new TRPCError({ code: "PRECONDITION_FAILED", message: formatUnpricedLines(unpriced) });
}
