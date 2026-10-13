/**
 * Ciclo de vida de un tenant: tabla cerrada de transiciones y política de acceso por estado.
 *
 *  provisioning → trial → active ⇄ grace → suspended → archived → deleting → deleted
 *
 * Cualquier transición que no esté en la tabla se rechaza. El borrado (`deleting`,
 * `deleted`) nunca es automático: exige un actor `operator` y un motivo explícito.
 */
import { RegistryError, type TenantStatus } from "./contract";

const TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  provisioning: ["trial", "active", "deleting"],
  trial: ["active", "grace", "suspended", "archived"],
  active: ["grace", "suspended", "archived"],
  grace: ["active", "suspended", "archived"],
  suspended: ["active", "grace", "archived"],
  archived: ["active", "suspended", "deleting"],
  deleting: ["deleted", "archived"],
  deleted: [],
};

export function allowedTransitions(from: TenantStatus): readonly TenantStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TenantStatus, to: TenantStatus): void {
  if (from === to) return; // idempotente: repetir el mismo estado no es un error
  if (!canTransition(from, to)) {
    throw new RegistryError("invalid_transition", `Transición no permitida: ${from} → ${to}`);
  }
}

/** Transiciones que exigen intervención humana explícita (nunca automáticas). */
export function requiresOperator(to: TenantStatus): boolean {
  return to === "deleting" || to === "deleted";
}

export interface AccessPolicy {
  /** Se sirve la web pública. */
  publicWeb: boolean;
  /** Se permite el acceso al panel de administración. */
  admin: boolean;
  /** Se permiten escrituras de negocio, cobros y envíos a terceros. */
  writes: boolean;
  /** Código HTTP a devolver cuando no se sirve la web. */
  blockedStatus: 410 | 503 | null;
}

const POLICY: Record<TenantStatus, AccessPolicy> = {
  provisioning: { publicWeb: false, admin: false, writes: false, blockedStatus: 503 },
  trial: { publicWeb: true, admin: true, writes: true, blockedStatus: null },
  active: { publicWeb: true, admin: true, writes: true, blockedStatus: null },
  grace: { publicWeb: true, admin: true, writes: true, blockedStatus: null },
  suspended: { publicWeb: false, admin: true, writes: false, blockedStatus: 503 },
  archived: { publicWeb: false, admin: false, writes: false, blockedStatus: 410 },
  deleting: { publicWeb: false, admin: false, writes: false, blockedStatus: 410 },
  deleted: { publicWeb: false, admin: false, writes: false, blockedStatus: 410 },
};

export function accessPolicy(status: TenantStatus): AccessPolicy {
  return POLICY[status];
}

/** ¿Se atiende la petición con la web pública? */
export function servesPublicWeb(status: TenantStatus): boolean {
  return POLICY[status].publicWeb;
}
