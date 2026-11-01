/**
 * Intentos de compra de Elephant Connect en el navegador: una clave de idempotencia ESTABLE por intento.
 *
 *  - Reintentar (fallo de red, doble clic, recargar la página) reutiliza la misma clave: el plano de control devuelve
 *    el mismo pedido y nunca cobra dos veces.
 *  - Solo un resultado definitivo del backend cierra el intento: `applied` (licencias concedidas), `failed` o
 *    `expired`. Volver de la página de pago NO cierra nada: el estado se vuelve a consultar (`purchaseStatus`).
 *  - Lo guardado es solo una comodidad de esta persona (clave y número de pedido); la verdad está en el backend.
 */

import { randomId } from "./randomId";

export type PurchaseStatus = "applied" | "payment_pending" | "processing" | "expired" | "failed";

export interface PurchaseAttempt {
  productKey: string;
  idempotencyKey: string;
  /** null hasta que el backend acepta el pedido. */
  orderId: number | null;
  status: PurchaseStatus | "draft";
  paymentUrl: string | null;
  startedAt: number;
}

/** Almacén clave-valor (localStorage envuelto; en pruebas, memoria). Nunca debe lanzar. */
export interface AttemptStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

const PREFIX = "elephant-connect:attempt:";
/** Un intento sin pedido aceptado deja de reutilizarse pasado este tiempo. */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

const slot = (scope: string, productKey: string) => `${PREFIX}${scope}:${productKey}`;

export function newIdempotencyKey(random: () => string = () => randomId()): string {
  return random().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64).padEnd(16, "0");
}

function parse(raw: string | null): PurchaseAttempt | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as PurchaseAttempt;
    if (typeof a?.productKey !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(String(a.idempotencyKey))) return null;
    return a;
  } catch {
    return null;
  }
}

export function loadAttempt(s: AttemptStorage, scope: string, productKey: string, now: number): PurchaseAttempt | null {
  const a = parse(s.get(slot(scope, productKey)));
  if (!a) return null;
  if (a.status === "draft" && now - a.startedAt > DRAFT_TTL_MS) {
    s.remove(slot(scope, productKey));
    return null;
  }
  return a;
}

/** Abre (o retoma) el intento de compra de un producto: misma clave mientras no haya un resultado definitivo. */
export function beginAttempt(s: AttemptStorage, scope: string, productKey: string, now: number, makeKey: () => string = newIdempotencyKey): PurchaseAttempt {
  const open = loadAttempt(s, scope, productKey, now);
  if (open) return open;
  const a: PurchaseAttempt = { productKey, idempotencyKey: makeKey(), orderId: null, status: "draft", paymentUrl: null, startedAt: now };
  s.set(slot(scope, productKey), JSON.stringify(a));
  return a;
}

export type AttemptPhase = "confirmed" | "waiting" | "closed";

/** confirmed: el backend ha aplicado la compra · waiting: hay que seguir consultando · closed: no se hizo (sin cargo). */
export function phaseOf(status: PurchaseStatus): AttemptPhase {
  if (status === "applied") return "confirmed";
  if (status === "failed" || status === "expired") return "closed";
  return "waiting";
}

/**
 * Registra la respuesta del backend (compra o consulta de estado). Un resultado definitivo cierra el intento (el
 * siguiente usará una clave nueva); uno intermedio lo conserva para seguir consultando, también tras recargar.
 */
export function recordResult(s: AttemptStorage, scope: string, attempt: PurchaseAttempt, r: { status: PurchaseStatus; orderId?: number | null; paymentUrl?: string | null }): PurchaseAttempt {
  const next: PurchaseAttempt = { ...attempt, status: r.status, orderId: r.orderId ?? attempt.orderId, paymentUrl: r.paymentUrl ?? (r.status === "payment_pending" ? attempt.paymentUrl : null) };
  if (phaseOf(r.status) === "waiting") s.set(slot(scope, attempt.productKey), JSON.stringify(next));
  else s.remove(slot(scope, attempt.productKey));
  return next;
}

/** Intentos con pedido aceptado y sin resultado definitivo: se retoman al abrir la página. */
export function openOrders(s: AttemptStorage, scope: string): PurchaseAttempt[] {
  const p = `${PREFIX}${scope}:`;
  return s
    .keys()
    .filter((k) => k.startsWith(p))
    .map((k) => parse(s.get(k)))
    .filter((a): a is PurchaseAttempt => !!a && a.orderId !== null && a.status !== "draft" && phaseOf(a.status) === "waiting");
}

/** Cada cuánto se vuelve a consultar un pedido en espera (sin martillear al backend). */
export function pollDelayMs(status: PurchaseStatus | "draft", attempt: number): number | false {
  if (status !== "processing" && status !== "payment_pending") return false;
  // processing (cobro en curso): rápido al principio; pago pendiente en el banco: más espaciado
  const base = status === "processing" ? 3_000 : 10_000;
  return Math.min(base * 2 ** Math.min(attempt, 4), 60_000);
}

/** localStorage envuelto: si no está disponible (navegación privada, bloqueado), se comporta como vacío. */
export function browserAttemptStorage(): AttemptStorage {
  const ls = (): Storage | null => {
    try {
      return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
      return null;
    }
  };
  return {
    get: (k) => {
      try {
        return ls()?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        ls()?.setItem(k, v);
      } catch {
        /* sin almacenamiento: el intento vive solo en memoria */
      }
    },
    remove: (k) => {
      try {
        ls()?.removeItem(k);
      } catch {
        /* nada */
      }
    },
    keys: () => {
      try {
        const s = ls();
        if (!s) return [];
        return Array.from({ length: s.length }, (_, i) => s.key(i)).filter((k): k is string => !!k);
      } catch {
        return [];
      }
    },
  };
}

export function memoryAttemptStorage(): AttemptStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k), keys: () => Array.from(data.keys()) };
}
