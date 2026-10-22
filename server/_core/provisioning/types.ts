/**
 * Aprovisionamiento automático de tenants.
 *
 * Una solicitud de alta se ejecuta como una máquina de estados de pasos idempotentes y
 * reanudables. El estado se persiste tras cada paso: si el proceso cae, `run()` continúa
 * donde quedó sin repetir lo hecho ni duplicar recursos.
 */

export const PROVISION_STEPS = [
  "register", // tenant en el registro (provisioning)
  "database", // BD física + usuario propio + DSN cifrado en el registro
  "schema", // baseline + migraciones
  "activate_database", // la BD pasa a activa
  "modules", // migraciones de los módulos contratados
  "admin", // administrador inicial (invitación)
  "domain", // subdominio de plataforma activo
  "branding", // marca
  "template", // plantilla CMS (opcional)
  "entitlements", // módulos de la prueba
  "quotas", // cuotas de la prueba
  "activate", // trial + bienvenida
] as const;

export type ProvisionStep = (typeof PROVISION_STEPS)[number];

export interface ProvisionRequest {
  tenantId: string;
  displayName: string;
  adminEmail: string;
  adminName?: string;
  /** Dominio base de plataforma; el subdominio es `<tenantId>.<platformDomain>`. */
  platformDomain: string;
  modules?: string[];
  /** Días de prueba (por defecto 15). */
  trialDays?: number;
  brand?: Partial<Record<"name" | "phone" | "email" | "logoUrl" | "primaryColor" | "accentColor", string>>;
  quotas?: Array<{ metric: string; period: "minute" | "hour" | "day" | "month"; limit: number; enforcement: "hard" | "soft" }>;
  templateId?: string;
  /** Servidor MySQL pedido de forma explícita (alias de PROVISIONING_DB_SERVERS); por defecto, la política de colocación. */
  serverAlias?: string;
}

export type StepState = { state: "done"; at: number; info?: Record<string, string | number | boolean | null> } | { state: "failed"; at: number; error: string };

export interface ProvisioningRecord {
  tenantId: string;
  request: ProvisionRequest;
  steps: Partial<Record<ProvisionStep, StepState>>;
  status: "pending" | "running" | "failed" | "completed" | "aborted";
  attempts: number;
  lastError: string | null;
  updatedAt: number;
}

export interface ProvisionResult {
  tenantId: string;
  status: ProvisioningRecord["status"];
  completedSteps: ProvisionStep[];
  failedStep?: ProvisionStep;
  error?: string;
  /** Solo presente en la ejecución que creó al administrador; nunca se persiste. */
  adminInviteToken?: string;
  domain?: string;
}

export class ProvisioningError extends Error {
  constructor(
    public readonly code: "invalid_request" | "conflict" | "aborted" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "ProvisioningError";
  }
}

export const TENANT_ID_RE = /^[a-z][a-z0-9-]{1,40}[a-z0-9]$/;
