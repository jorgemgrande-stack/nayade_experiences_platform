/**
 * Contrato v1 del registro central de tenants.
 *
 * El registro es el único lugar donde se declara qué tenants existen, con qué dominios se
 * accede a ellos y a qué base de datos pertenecen. Está SEPARADO de los datos operativos de
 * cada tenant y de la futura gestión comercial (Big Elephant CRM): aquí solo hay hechos
 * operativos. No contiene planes, módulos contratados ni datos de facturación o consumo.
 *
 * Cambios compatibles dentro de la misma versión mayor: solo aditivos.
 */
import { isValidTenantId } from "../tenant";

export const REGISTRY_CONTRACT_VERSION = "1.0.0";

/** Versión mayor del contrato que este Core sabe operar. */
export const SUPPORTED_CONTRACT_MAJOR = 1;

export const TENANT_STATUSES = [
  "provisioning",
  "trial",
  "active",
  "grace",
  "suspended",
  "archived",
  "deleting",
  "deleted",
] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const DOMAIN_KINDS = ["platform_subdomain", "custom"] as const;
export type DomainKind = (typeof DOMAIN_KINDS)[number];

export const DOMAIN_STATUSES = ["pending_verification", "verified", "active", "disabled", "removed"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const DATABASE_STATES = ["pending", "active", "retired"] as const;
export type DatabaseState = (typeof DATABASE_STATES)[number];

export type ActorType = "system" | "operator" | "crm";

/**
 * Tenant. `id` es INMUTABLE: es la clave de toda caché, del almacenamiento y de todas las
 * métricas de Elephant Resource Manager. Nunca se reutiliza ni se renombra.
 */
export interface Tenant {
  id: string;
  displayName: string;
  status: TenantStatus;
  statusReason: string | null;
  baselineVersion: string | null;
  schemaVersion: string | null;
  /** Se incrementa en cada cambio: concurrencia optimista e invalidación de cachés. */
  registryVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantDomain {
  /** Minúsculas, punycode, sin puerto. Único en todo el registro. */
  domain: string;
  tenantId: string;
  kind: DomainKind;
  status: DomainStatus;
  isPrimary: boolean;
  verificationToken: string | null;
  verifiedAt: Date | null;
  activatedAt: Date | null;
  createdAt: Date;
}

/** Referencia a la BD de un tenant. El DSN solo existe cifrado; nunca se expone en claro. */
export interface TenantDatabaseRef {
  id: number;
  tenantId: string;
  state: DatabaseState;
  /** AES-256-GCM, ligado al tenant (AAD). Ver crypto.ts. */
  dsnCipher: string;
  keyId: string;
  serverAlias: string | null;
  createdAt: Date;
  rotatedAt: Date | null;
}

export interface TenantEvent {
  id: number;
  tenantId: string;
  at: Date;
  actorType: ActorType;
  actorId: string;
  action: string;
  fromState: string | null;
  toState: string | null;
  /** Nunca secretos. */
  details: Record<string, unknown> | null;
  requestId: string | null;
}

export type RegistryErrorCode =
  | "invalid_tenant_id"
  | "invalid_domain"
  | "not_found"
  | "conflict"
  | "invalid_transition"
  | "stale_version"
  | "forbidden"
  | "crypto"
  | "unsupported_contract";

export class RegistryError extends Error {
  constructor(
    public readonly code: RegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

export function assertTenantId(id: unknown): asserts id is string {
  if (!isValidTenantId(id)) throw new RegistryError("invalid_tenant_id", "Identificador de tenant no válido");
}

/** El Core solo opera con contratos de su misma versión mayor. */
export function assertSupportedContract(version: string): void {
  const major = Number(version.split(".")[0]);
  if (!Number.isInteger(major) || major !== SUPPORTED_CONTRACT_MAJOR) {
    throw new RegistryError(
      "unsupported_contract",
      `Contrato de registro ${version} no soportado (este Core opera con ${SUPPORTED_CONTRACT_MAJOR}.x)`,
    );
  }
}
