/**
 * Licencias por CAPACIDAD de Elephant Source (ids estables de server/catalog/capabilities.ts).
 *
 * Reglas:
 *  - La emite el plano de control; vive en el registro (fuera de la BD del tenant). El Core solo lee.
 *  - Se comprueba en el SERVIDOR, en cada operación (rutas tRPC), nunca solo ocultando menús.
 *  - `read_only` permite consultar y bloquea operar (p. ej. prueba vencida: los datos se conservan).
 *  - Una licencia de empresa (`siteId = ''`) cubre todas las sedes; una de sede, solo esa sede.
 *  - Modo `single` (instalación actual de una sola empresa): no se aplica (todo permitido).
 */

export const CAPABILITY_STATUSES = ["contracted", "pending_setup", "active", "read_only", "suspended", "cancelled"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];
export const COMPANY_WIDE = "";

export interface CapabilityGrant {
  tenantId: string;
  capabilityId: string;
  /** '' = toda la empresa. */
  siteId: string;
  status: CapabilityStatus;
  /** ms; null = sin caducidad. */
  validUntil: number | null;
  /** subscription:<id> | trial:<id> | operator */
  source: string;
  updatedAt: number;
  updatedBy: string;
}

export interface CapabilityEvent {
  tenantId: string;
  capabilityId: string;
  siteId: string;
  fromStatus: CapabilityStatus | null;
  toStatus: CapabilityStatus;
  source: string;
  actor: string;
  reason: string | null;
  at: number;
}

export type Decision = { allowed: true; status: CapabilityStatus } | { allowed: false; status: CapabilityStatus | "not_contracted" | "expired"; reason: string };

/**
 * Decide el acceso a una capacidad con las licencias del tenant.
 *  - `write`: la operación modifica datos (mutación).
 *  - `siteId`: sede de la operación (si la hay); una licencia de empresa cubre cualquier sede.
 */
export function decide(grants: CapabilityGrant[], capabilityId: string, o: { write: boolean; siteId?: string | null; now: number }): Decision {
  const candidates = grants.filter((g) => g.capabilityId === capabilityId && (g.siteId === COMPANY_WIDE || (o.siteId ? g.siteId === o.siteId : false)));
  if (!candidates.length) return { allowed: false, status: "not_contracted", reason: `Capacidad no contratada: ${capabilityId}` };
  // La más favorable: activa > solo lectura > el resto
  const rank = (s: CapabilityStatus) => (s === "active" ? 3 : s === "read_only" ? 2 : 1);
  const best = candidates.slice().sort((a, b) => rank(b.status) - rank(a.status))[0];
  if (best.validUntil !== null && best.validUntil <= o.now && best.status === "active") {
    // Caducada (p. ej. fin de prueba sin conversión): se consulta, no se opera
    return o.write ? { allowed: false, status: "expired", reason: `La licencia de ${capabilityId} ha caducado: solo lectura` } : { allowed: true, status: "read_only" };
  }
  if (best.status === "active") return { allowed: true, status: "active" };
  if (best.status === "read_only") return o.write ? { allowed: false, status: "read_only", reason: `${capabilityId} está en solo lectura` } : { allowed: true, status: "read_only" };
  const label: Record<string, string> = { contracted: "contratada, pendiente de activar", pending_setup: "pendiente de configuración", suspended: "suspendida", cancelled: "cancelada" };
  return { allowed: false, status: best.status, reason: `Capacidad ${capabilityId} ${label[best.status] ?? best.status}` };
}
