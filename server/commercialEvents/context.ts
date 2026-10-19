/**
 * Origen y causa de los eventos comerciales que se escriben durante una operación. Quien procesa una
 * causa externa (p. ej. un evento firmado de Stripe) envuelve su trabajo con `withCommercialCause`; los
 * almacenes no necesitan saberlo. Sin contexto, el origen se deduce del actor.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { CommercialSource } from "./types";

interface Cause {
  source: CommercialSource;
  causationId: string | null;
}

const als = new AsyncLocalStorage<Cause>();

export function withCommercialCause<T>(cause: Cause, fn: () => Promise<T>): Promise<T> {
  return als.run({ source: cause.source, causationId: cause.causationId ? cause.causationId.slice(0, 120) : null }, fn);
}

export function currentCause(): Cause | undefined {
  return als.getStore();
}

/**
 * Origen a partir del actor cuando no hay contexto: `system:stripe` y `stripe…` → stripe; `web…` o
 * `customer…` → cliente; `system:…` → sistema; cualquier otro (operador o clave de API) → operador.
 */
export function sourceOfActor(actor: string): CommercialSource {
  const a = actor.toLowerCase();
  if (a === "system:stripe" || a.startsWith("stripe")) return "stripe";
  if (a.startsWith("web") || a.startsWith("customer") || a.startsWith("public")) return "customer";
  if (a.startsWith("system")) return "system";
  return "operator";
}
