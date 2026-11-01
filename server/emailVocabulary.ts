/**
 * Vocabulario de los correos según la empresa en curso.
 *
 *  - Instalación propia o empresa anterior al motor de licencias: los textos de siempre (reservas, experiencias…).
 *  - Empresa con licencias por capacidad y sin «Reservas y citas»: textos genéricos (pedido, pago, vale de compra…).
 *
 * Las plantillas se pintan de forma síncrona, así que la decisión se precarga por empresa en el borde (petición o
 * tarea, junto a los ajustes) con `warmEmailVocabulary()` y se lee con `emailsAreGeneric()`. Sin precarga, en
 * multiempresa se usan los genéricos (valen para cualquier empresa). Solo presentación: no autoriza nada.
 */
import { getTenantMode } from "./_core/tenant";
import { TenantCache } from "./_core/tenantScope";
import { getCapabilityAccess } from "./_core/capabilities/access";
import { buildSubscriptionOverview } from "./subscriptionOverview";

const KEY = "generic";
const cache = new TenantCache<boolean>(30_000);
let forced: boolean | null = null;

/** Lee las licencias de la empresa en curso: true si sus correos van con textos genéricos. */
export async function resolveGenericEmails(): Promise<boolean> {
  const mode = getTenantMode();
  if (mode !== "multi") return false;
  try {
    const access = getCapabilityAccess();
    const o = buildSubscriptionOverview({ mode, enforcing: access.enforcing(), grants: await access.list(), now: access.currentTime() });
    if (o.licensing !== "capabilities") return false;
    return !o.visible.includes("bookings-generic");
  } catch {
    return true;
  }
}

/** Precarga la decisión de la empresa en curso. Nunca lanza. */
export async function warmEmailVocabulary(): Promise<void> {
  if (getTenantMode() !== "multi" || cache.get(KEY) !== undefined) return;
  try {
    cache.set(KEY, await resolveGenericEmails());
  } catch {
    /* sin contexto de empresa: se usa el valor por defecto */
  }
}

/** true si los correos de la empresa en curso llevan los textos genéricos. */
export function emailsAreGeneric(): boolean {
  if (forced !== null) return forced;
  if (getTenantMode() !== "multi") return false;
  return cache.get(KEY) ?? true;
}

/** Pinta `fn` con el vocabulario indicado (siembra y restauración de plantillas, pruebas). */
export function renderEmailAs<T>(generic: boolean, fn: () => T): T {
  const prev = forced;
  forced = generic;
  try {
    return fn();
  } finally {
    forced = prev;
  }
}

/** Texto de siempre o genérico, según la empresa. */
export function ew(legacy: string, generic: string): string {
  return emailsAreGeneric() ? generic : legacy;
}
